import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { mkdir, writeFile, readFile, rm, symlink, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { ParsedArgs } from './parseArgs.js';
import type {
  ResolvedVantageConfig,
  EngineName,
  ViewportName,
  VantageAuth,
  VantageWebServer,
} from '../types.js';
import { ALL_VIEWPORTS } from '../viewports.js';
import { DEFAULT_CONSOLE_IGNORE } from '../console-ignore-defaults.js';
import { writeDisabledRulesArtefact } from '../report/disabled-rules.js';
import { assembleManifest, type GateRouteRecord } from '../gate/manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require_ = createRequire(import.meta.url);

/**
 * Resolve the Playwright CLI entry. We resolve from the consumer's CWD so
 * that the consumer's installed @playwright/test (declared as a peerDep) is
 * used, not vantage's own copy.
 */
function resolvePlaywrightCli(consumerCwd: string): string {
  const fromConsumer = createRequire(path.join(consumerCwd, 'package.json'));
  try {
    return fromConsumer.resolve('@playwright/test/cli');
  } catch {
    // Fall back to vantage's bundled dev dep so smoke-runs in CI of the
    // vantage repo itself still work.
    try {
      return require_.resolve('@playwright/test/cli');
    } catch {
      throw new EnvError(
        '@playwright/test is not installed. Run `npm i -D @playwright/test` in your project, ' +
          'then `npx playwright install` to fetch browser binaries.'
      );
    }
  }
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export interface RunOptions {
  args: ParsedArgs;
  rawConfig: ResolvedVantageConfig;
  consumerCwd: string;
  vantageVersion: string;
}

export interface RunResult {
  exitCode: number;
}

/**
 * Cadence-aware default wall-clock cap for the whole Playwright run.
 *
 * Why each value: --smoke is a per-push budget (chromium + mobile-375
 * only, ~17 s in the repo's own CI fixture) so 5 min is generous
 * headroom for the largest reasonable smoke surface; default is the
 * PR-open cadence advertised as "1–5 min" in README but realistic
 * upper bound of ~16 min on a 36-route 15-project matrix has been
 * observed in the wild, so 30 min covers that and leaves slack;
 * --release adds Lighthouse (1 spec × routes, ~5–15 s each on
 * desktop-1280) + NVDA (Windows-only, single-worker, ~10 s per
 * route) + html-validate, so 60 min; --visual restricts to one
 * project, so 30 min suffices.
 *
 * `cfg.runnerTimeoutMs` overrides this for ALL cadences in the same
 * run. Consumers who want per-cadence overrides branch on
 * `process.argv` in their vantage.config.ts.
 */
function defaultRunnerTimeoutMs(args: ParsedArgs): number {
  if (args.smoke) return 5 * 60 * 1000;
  if (args.release) return 60 * 60 * 1000;
  // --gate renders one project × all routes (screenshot + DOM + axe each).
  // 15 min is generous headroom for a typical surface; the runner driving
  // the gate can raise it via cfg.runnerTimeoutMs for a large route set.
  if (args.gate) return 15 * 60 * 1000;
  if (args.visual) return 30 * 60 * 1000;
  return 30 * 60 * 1000; // default cadence (full engine × viewport matrix)
}

/**
 * Grace window between Playwright's globalTimeout firing and the
 * parent SIGKILL. 90 s covers worker-shutdown + JSON-reporter flush
 * + html-reporter finalisation on a deadlocked WebKit-on-Windows
 * shape. Shorter values risk killing Playwright mid-flush and
 * producing the same all-zeros summary the v0.6.0 hang produced.
 */
const RUNNER_KILL_GRACE_MS = 90_000;

export async function run(opts: RunOptions): Promise<RunResult> {
  const { args, rawConfig, consumerCwd } = opts;

  const cfg = applyRunFlagsToConfig(rawConfig, args);

  if (args.gate) {
    const disallowed = gateDisallowedResolvedKeys(cfg);
    if (disallowed.length > 0) {
      process.stderr.write(
        `vantage --gate: resolved config includes disallowed gate key(s): ${disallowed.join(', ')}. ` +
          'Gate config must be inert data; remove executable hooks, Playwright overrides, and finding suppressions.\n'
      );
      return { exitCode: 2 };
    }
  }

  // --gate collapses to a single project so each route is captured once and
  // the manifest hash is stable. If the inert config resolved to more than
  // one engine/viewport (e.g. it omitted them and inherited the 3×5 default),
  // say which project we actually rendered so the discard is never silent —
  // the rendered project is bound into the manifest hash regardless.
  if (
    args.gate &&
    (rawConfig.engines.length > 1 || rawConfig.viewports.length > 1)
  ) {
    process.stderr.write(
      `[vantage] gate: config resolved to ${rawConfig.engines.length} engine(s) × ` +
        `${rawConfig.viewports.length} viewport(s); rendering only ${cfg.engines[0]}__${cfg.viewports[0]}. ` +
        'Set engines/viewports to one each in the gate config to make the rendered project explicit.\n'
    );
  }

  const globalTimeoutMs = cfg.runnerTimeoutMs ?? defaultRunnerTimeoutMs(args);
  const killAfterMs = globalTimeoutMs + RUNNER_KILL_GRACE_MS;

  const lastRunDir = path.join(consumerCwd, '.vantage', 'last-run');
  await rm(lastRunDir, { recursive: true, force: true });
  await mkdir(lastRunDir, { recursive: true });

  // --gate writes per-route capture artefacts (DOM snapshot, screenshot,
  // sidecar record) into this dir; the parent runner then assembles the
  // ordered, deterministic gate-manifest.json from them after Playwright
  // exits. Create it unconditionally so the spec's writes never race a mkdir.
  const gateDir = path.join(lastRunDir, 'gate');
  if (args.gate) await mkdir(gateDir, { recursive: true });

  // Auth lifecycle: if cfg.auth is set and --no-auth was not passed, run
  // the consumer's setup module (or reuse a cached storageState that is
  // still within its expiry window). This block is unreachable in --gate:
  // gateDisallowedResolvedKeys() above fail-closes cfg.auth before any
  // module path can be imported.
  let storageStatePath: string | undefined;
  if (cfg.auth && !args.noAuth) {
    try {
      storageStatePath = await ensureAuthStorageState(cfg.auth, consumerCwd, args.verbose);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[vantage] auth setup failed: ${msg}\n`);
      return { exitCode: 4 };
    }
  }

  const htmlReportDir = path.join(lastRunDir, 'html-report');
  const junitFile = path.join(lastRunDir, 'junit.xml');
  const jsonFile = path.join(lastRunDir, 'results.json');
  const testResultsDir = path.join(lastRunDir, 'test-results');

  await writeDisabledRulesArtefact(lastRunDir, cfg.axeDisabled);

  // Merge consumer consoleIgnore with built-in defaults (concat, not replace).
  const consoleIgnoreCombined = [...DEFAULT_CONSOLE_IGNORE, ...cfg.consoleIgnore];

  // Pre-resolve webServer.cwd so playwright.config.ts never depends on
  // process.cwd() semantics — the dist directory of vantage is the
  // wrong cwd for any webServer.command with a relative path, and the
  // bug only surfaces with consumer-managed servers (v0.1/v0.2 hid it
  // by using webServer:false). Resolve once, in the parent runner.
  const resolvedWebServer =
    cfg.webServer === false
      ? cfg.webServer
      : {
          ...cfg.webServer,
          cwd: cfg.webServer.cwd
            ? path.isAbsolute(cfg.webServer.cwd)
              ? cfg.webServer.cwd
              : path.join(consumerCwd, cfg.webServer.cwd)
            : consumerCwd,
        };

  const serialised = {
    ...cfg,
    webServer: resolvedWebServer,
    consoleIgnore: consoleIgnoreCombined.map((r) => ({ source: r.source, flags: r.flags })),
    storageStatePath,
  };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VANTAGE_CONFIG_JSON: JSON.stringify(serialised),
    VANTAGE_HTML_REPORT_DIR: htmlReportDir,
    VANTAGE_JUNIT_FILE: junitFile,
    VANTAGE_JSON_FILE: jsonFile,
    VANTAGE_TEST_RESULTS_DIR: testResultsDir,
    VANTAGE_CI: args.ci ? '1' : '0',
    VANTAGE_NO_REUSE: args.noReuse ? '1' : '0',
    // Never inherit a handoff claim from a previous/outer runner.
    VANTAGE_OWNED_WEB_SERVER: '0',
    VANTAGE_VERBOSE: args.verbose ? '1' : '0',
    VANTAGE_SMOKE: args.smoke ? '1' : '0',
    VANTAGE_RELEASE: args.release ? '1' : '0',
    VANTAGE_VISUAL: args.visual ? '1' : '0',
    VANTAGE_GATE: args.gate ? '1' : '0',
    VANTAGE_GATE_DIR: gateDir,
    // Wall-clock cap forwarded to playwright.config.ts → `globalTimeout`.
    // The parent runner ALSO enforces this via a SIGKILL after a 90 s
    // grace window — see runPlaywright() and the v0.6.1 CHANGELOG entry.
    VANTAGE_GLOBAL_TIMEOUT_MS: String(globalTimeoutMs),
    // VANTAGE_VERSION is intentionally NOT forwarded — writeSummary in the
    // parent process takes the version directly, so the child does not need it.
  };
  if (args.debug) env.PWDEBUG = '1';
  if (args.reporter) env.VANTAGE_REPORTER = args.reporter;

  const playwrightCli = resolvePlaywrightCli(consumerCwd);
  const pwConfigPath = path.join(__dirname, '..', 'playwright.config.js');

  const cliArgs: string[] = [playwrightCli, 'test', '--config', pwConfigPath];
  if (args.headed) cliArgs.push('--headed');
  if (args.updateSnapshots) cliArgs.push('--update-snapshots');

  if (args.verbose) {
    process.stderr.write(`[vantage] launching: node ${cliArgs.map((a) => quote(a)).join(' ')}\n`);
  }

  let ownedServer: ReturnType<typeof launchOwnedWebServer> | undefined;
  let playwrightResult: PlaywrightRunResult;
  try {
    if (!args.gate && resolvedWebServer !== false && (args.ci || args.noReuse)) {
      const url = webServerUrl(resolvedWebServer);
      await requireFreeWebServerPort(url);
      ownedServer = launchOwnedWebServer(resolvedWebServer, url, env);
      await ownedServer.ready;
      env.VANTAGE_OWNED_WEB_SERVER = '1';
    }
    playwrightResult = await runPlaywright(
      cliArgs,
      env,
      consumerCwd,
      killAfterMs,
      args.verbose
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[vantage] child-bound readiness: ${message}\n`);
    // Readiness refusals are EnvError-class: 3 = environment error per the
    // README exit table and bin's EXIT mapping (4 stays runtime/hang).
    return { exitCode: 3 };
  } finally {
    await ownedServer?.stop();
  }
  const { exitCode, hangDetected } = playwrightResult;

  const totals = await tallyResults(jsonFile);
  const cadence: SummaryJson['cadence'] = args.visual
    ? 'visual'
    : args.gate
      ? 'gate'
      : args.smoke
        ? 'smoke'
        : args.release
          ? 'release'
          : 'full';

  // --gate: assemble the ordered, deterministic manifest from the per-route
  // sidecars the spec captured. Fail closed if a route produced no capture
  // even though Playwright reported success (e.g. zero tests matched) — a
  // silently-incomplete surface must never read as a green gate.
  let finalExitCode = exitCode;
  if (args.gate) {
    const project = `${cfg.engines[0]}__${cfg.viewports[0]}`;
    const gateOutcome = await assembleGateManifest({
      lastRunDir,
      gateDir,
      cfg,
      vantageVersion: opts.vantageVersion,
      project,
      surface: process.env.VANTAGE_GATE_SURFACE,
      verbose: args.verbose,
    });
    if (!gateOutcome.coverageComplete && finalExitCode === 0) {
      process.stderr.write(
        `[vantage] gate: coverage incomplete — no capture for route index(es) ` +
          `${gateOutcome.missingRoutes.join(', ')}. Failing the gate (exit 1).\n`
      );
      finalExitCode = 1;
    }
  }

  await writeSummary(
    lastRunDir,
    cfg,
    finalExitCode,
    opts.vantageVersion,
    totals,
    cadence,
    hangDetected ? { hangDetected: true, globalTimeoutMs, killAfterMs } : undefined
  );

  // Convenience symlink: .vantage/last-run/index.html → html-report/index.html.
  // Symlink creation on Windows requires elevation or Developer Mode; if it
  // fails we fall back to a tiny redirect HTML so the path still resolves.
  await linkOrRedirect(lastRunDir, htmlReportDir);

  return { exitCode: finalExitCode };
}

function webServerUrl(config: VantageWebServer): URL {
  const url = new URL(config.url ?? `http://localhost:${config.port}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EnvError('webServer readiness requires an HTTP(S) URL');
  }
  return url;
}

async function requireFreeWebServerPort(url: URL): Promise<void> {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once('connect', () => finish(new EnvError(
      `configured port already served by a foreign process (${host}:${port}); stop it before --no-reuse/--ci`
    )));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED' ? undefined : new EnvError(
        `cannot establish configured port exclusivity (${host}:${port}): ${error.message}`
      ));
    });
    socket.setTimeout(1_000, () => finish(new EnvError(
      `configured port exclusivity probe timed out (${host}:${port})`
    )));
  });
}

/** Runner owns readiness and the entire shell command's process tree. */
function launchOwnedWebServer(config: VantageWebServer, url: URL, env: NodeJS.ProcessEnv) {
  const child = spawn(config.command, {
    cwd: config.cwd,
    env: { ...env, ...config.env },
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const observedPorts = new Set<number>();
  let alive = true;
  let settled = false;
  let healthy = false;
  let request: http.ClientRequest | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadlineTimer);
    if (pollTimer) clearTimeout(pollTimer);
    request?.destroy();
    if (error) rejectReady(error);
    else {
      process.stderr.write('[vantage] child-bound readiness: GREEN (launched child alive)\n');
      resolveReady();
    }
  };
  child.once('error', (err) => {
    alive = false;
    finish(new EnvError(`webServer spawn failed: ${err.message}`));
  });
  child.once('exit', (code, signal) => {
    alive = false;
    finish(new EnvError(`webServer child exited before readiness (code=${code}, signal=${signal})`));
  });
  const observe = (stream: NodeJS.ReadableStream, destination: NodeJS.WriteStream) => {
    let pending = '';
    stream.on('data', (chunk: Buffer) => {
      destination.write(chunk);
      pending += chunk.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop()!.slice(-8_192);
      for (const line of lines) {
        for (const match of line.matchAll(/https?:\/\/(?:\[[^\]]+\]|[^\s/:]+):([0-9]+)(?=[/\s]|$)/g)) {
          observedPorts.add(Number(match[1]));
        }
      }
    });
  };
  observe(child.stdout, process.stdout);
  observe(child.stderr, process.stderr);

  const poll = () => {
    if (settled) return;
    // A relocated address permanently disables the no-output fallback.
    if (observedPorts.size > 0 && !observedPorts.has(port)) {
      healthy = false;
      pollTimer = setTimeout(poll, 100);
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    request = transport.get(url, (response) => {
      response.resume();
      healthy = (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 404;
      if (healthy && alive && observedPorts.has(port)) finish();
      else if (!settled) pollTimer = setTimeout(poll, 100);
    });
    request.setTimeout(1_000, () => request?.destroy());
    request.once('error', () => {
      healthy = false;
      if (!settled) pollTimer = setTimeout(poll, 100);
    });
  };
  deadlineTimer = setTimeout(() => {
    // Wait out the observation window before declaring a command silent:
    // a later relocated-address line must never lose a race to an early poll.
    if (alive && healthy && observedPorts.size === 0) finish();
    else finish(new EnvError(
      `webServer readiness timeout (${config.timeout ?? 120_000}ms); configured port ${port}; ` +
      `observed port(s): ${[...observedPorts].join(', ') || 'none'}`
    ));
  }, config.timeout ?? 120_000);
  poll();

  const stop = async () => {
    if (!settled) finish(new EnvError('webServer readiness cancelled'));
    if (!child.pid) return;
    if (process.platform === 'win32') {
      // child.kill() kills cmd.exe alone on Windows, orphaning npm/dev servers.
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        killer.once('error', () => { child.kill('SIGKILL'); resolve(); });
        killer.once('exit', () => resolve());
      });
    } else {
      const killGroup = (signal: NodeJS.Signals) => {
        try { process.kill(-child.pid!, signal); }
        catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
        }
      };
      killGroup('SIGTERM');
      // Keep escalation even if the shell exits before a stubborn descendant.
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      killGroup('SIGKILL');
    }
  };
  return { ready, stop };
}

function applyRunFlagsToConfig(
  cfg: ResolvedVantageConfig,
  args: ParsedArgs
): ResolvedVantageConfig {
  let engines: EngineName[] = cfg.engines;
  let viewports: ViewportName[] = cfg.viewports;

  if (args.smoke) {
    engines = ['chromium'];
    viewports = ['mobile-375'];
  }
  if (args.visual) {
    // Visual regression runs on exactly one project — derive it from
    // cfg.visualProject (default chromium__desktop-1280). Restricting
    // engines+viewports here avoids spawning workers for projects that
    // would only skip from inside the spec body.
    const projectName = cfg.visualProject ?? 'chromium__desktop-1280';
    const parsed = parseProjectName(projectName);
    if (!parsed) {
      throw new EnvError(
        `--visual: visualProject "${projectName}" is not a recognised engine__viewport project. ` +
          'Use a value matching one of the generated project names, e.g. "chromium__desktop-1280".'
      );
    }
    engines = [parsed.engine];
    viewports = [parsed.viewport];
  }
  if (args.gate) {
    // Gate renders each route ONCE on a single deterministic project so the
    // manifest has exactly one record per route (and a stable hash). The
    // runner-supplied inert config may narrow engines/viewports to one each;
    // otherwise collapse to chromium + desktop-1280 (the stable reference
    // project, matching the visual cadence default). --engine still overrides
    // the engine below.
    engines = cfg.engines.length === 1 ? cfg.engines : ['chromium'];
    viewports = cfg.viewports.length === 1 ? cfg.viewports : ['desktop-1280'];
  }
  if (args.engine) {
    engines = [args.engine];
  }

  return { ...cfg, engines, viewports };
}

/**
 * Gate backstop: list any resolved-config key that a gate config must not carry.
 * This runs on the RESOLVED config BEFORE the runner prepends its own
 * DEFAULT_CONSOLE_IGNORE for the child (that merge happens later — see
 * `consoleIgnoreCombined`). So for a clean inert gate config `cfg.consoleIgnore`
 * is [] here and is NOT rejected; this check only fires on a CONSUMER-supplied
 * consoleIgnore/axeDisabled (a suppression), never on vantage's own default.
 */
function gateDisallowedResolvedKeys(cfg: ResolvedVantageConfig): string[] {
  const disallowed: string[] = [];
  if (cfg.webServer !== false) disallowed.push('webServer.command');
  if (cfg.auth) disallowed.push('auth');
  if (cfg.playwrightOverrides) disallowed.push('playwrightOverrides');
  if (cfg.releaseOnlyPatterns) disallowed.push('releaseOnlyPatterns');
  // Resolved (pre-default-merge) consumer consoleIgnore only; [] for inert.
  if (cfg.consoleIgnore.length > 0) disallowed.push('consoleIgnore');
  if (cfg.axeDisabled.length > 0) disallowed.push('axeDisabled');
  if (cfg.lighthouseThresholds) disallowed.push('lighthouseThresholds');
  if (cfg.visualProject) disallowed.push('visualProject');
  if (cfg.visualThreshold !== undefined) disallowed.push('visualThreshold');
  if (cfg.htmlValidateRaw !== undefined) disallowed.push('htmlValidateRaw');
  for (const [i, route] of cfg.routes.entries()) {
    if (route.lighthouseThresholds) disallowed.push(`routes[${i}].lighthouseThresholds`);
  }
  return disallowed;
}

const VALID_ENGINES: ReadonlySet<EngineName> = new Set(['chromium', 'firefox', 'webkit']);

function parseProjectName(name: string): { engine: EngineName; viewport: ViewportName } | null {
  const idx = name.indexOf('__');
  if (idx === -1) return null;
  const engine = name.slice(0, idx);
  const viewport = name.slice(idx + 2);
  if (!VALID_ENGINES.has(engine as EngineName)) return null;
  if (!ALL_VIEWPORTS.includes(viewport as ViewportName)) return null;
  return { engine: engine as EngineName, viewport: viewport as ViewportName };
}

interface PlaywrightRunResult {
  exitCode: number;
  /**
   * True iff the wall-clock kill fired before the child exited on its
   * own. Propagated into summary.json so a CI consumer scripting on
   * the summary can detect a hang without parsing stderr.
   */
  hangDetected: boolean;
}

/**
 * Spawn Playwright and await its exit, with a hard wall-clock cap.
 *
 * If the child exits on its own, resolve with its exit code. If
 * `killAfterMs` elapses first, escalate kill signals (SIGTERM → wait
 * 10 s → SIGKILL) and resolve with exit 4 (RUNTIME_ERROR) plus
 * `hangDetected: true`. The 10-s SIGTERM grace lets Playwright write
 * a partial JSON reporter file in the happy-non-hang shutdown case;
 * SIGKILL is the belt-and-braces escape when even SIGTERM doesn't
 * reach the deadlocked worker pool.
 *
 * Windows-specific: SIGTERM does not actually terminate a Windows
 * process — Node maps it to taskkill /T (graceful) anyway, but in
 * practice the only signal that always kills is SIGKILL. So on
 * Windows the SIGTERM step is effectively a no-op delay; we keep the
 * structure cross-platform so behaviour is the same on macOS / Linux
 * where SIGTERM is meaningful.
 */
function runPlaywright(
  cliArgs: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  killAfterMs: number,
  verbose: boolean
): Promise<PlaywrightRunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, cliArgs, {
      stdio: 'inherit',
      env,
      cwd,
    });

    let settled = false;
    let hangDetected = false;
    let sigtermTimer: NodeJS.Timeout | undefined;
    let sigkillTimer: NodeJS.Timeout | undefined;

    const settle = (result: PlaywrightRunResult) => {
      if (settled) return;
      settled = true;
      if (sigtermTimer) clearTimeout(sigtermTimer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      clearTimeout(wallClockTimer);
      resolve(result);
    };

    const wallClockTimer = setTimeout(() => {
      if (settled) return;
      hangDetected = true;
      const minutes = (killAfterMs / 60_000).toFixed(1);
      process.stderr.write(
        `[vantage] Playwright did not exit within ${minutes} min wall-clock cap. ` +
          'Sending SIGTERM. If the worker pool is deadlocked (a known issue on multi-engine ' +
          'Windows runs), SIGKILL follows in 10 s.\n'
      );
      try {
        child.kill('SIGTERM');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[vantage] SIGTERM failed: ${msg}\n`);
      }
      sigkillTimer = setTimeout(() => {
        if (settled) return;
        process.stderr.write(
          '[vantage] Playwright did not exit 10 s after SIGTERM. Sending SIGKILL. ' +
            'summary.json will be written with hangDetected:true and exit code 4 ' +
            '(RUNTIME_ERROR). Inspect .vantage/last-run/ for partial results.\n'
        );
        try {
          child.kill('SIGKILL');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[vantage] SIGKILL failed: ${msg}\n`);
        }
        // Belt-and-braces: even SIGKILL can fail to reach a child whose
        // pid was reused or which has detached. Resolve after a further
        // 5 s so the parent never deadlocks waiting on a dead child.
        sigtermTimer = setTimeout(() => {
          if (settled) return;
          process.stderr.write(
            '[vantage] child did not exit 5 s after SIGKILL. Resolving anyway; ' +
              'the child process may be orphaned — check process inventory.\n'
          );
          settle({ exitCode: 4, hangDetected: true });
        }, 5_000);
      }, 10_000);
    }, killAfterMs);

    if (verbose) {
      const minutes = (killAfterMs / 60_000).toFixed(1);
      process.stderr.write(
        `[vantage] wall-clock cap on Playwright child: ${minutes} min (SIGKILL after grace).\n`
      );
    }

    child.on('exit', (code, signal) => {
      if (hangDetected) {
        // Child exited because of our kill escalation — record as runtime
        // error regardless of the signal that finally took it down.
        settle({ exitCode: 4, hangDetected: true });
        return;
      }
      if (signal) {
        process.stderr.write(`[vantage] Playwright terminated by signal ${signal}\n`);
        settle({ exitCode: 1, hangDetected: false });
      } else {
        settle({ exitCode: code ?? 1, hangDetected: false });
      }
    });
    child.on('error', (err) => {
      process.stderr.write(`[vantage] failed to spawn Playwright: ${err.message}\n`);
      settle({ exitCode: 4, hangDetected: false });
    });
  });
}

interface SummaryJson {
  version: string;
  finishedAt: string;
  // Discriminator shared with the lychee cadence's summary.json so a
  // single CI consumer can switch on it instead of inferring shape.
  cadence: 'smoke' | 'full' | 'release' | 'links' | 'visual' | 'gate';
  exitCode: number;
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    expected: number;
  } | null;
  config: {
    baseURL: string;
    routesCount: number;
    engines: EngineName[] | null;
    viewports: ViewportName[] | null;
    locale: string;
    timezoneId: string;
  };
  disabledAxeRules: { rule: string; reason: string }[] | null;
  /**
   * Set iff vantage's wall-clock cap fired before Playwright exited
   * on its own — i.e. the child was SIGKILLed by the parent runner.
   * Omitted (not `false`) on healthy runs so backwards-compatible CI
   * consumers that key on a missing field see the historical shape.
   */
  hang?: {
    hangDetected: true;
    /** Playwright globalTimeout used for this run, in ms. */
    globalTimeoutMs: number;
    /** Total wall-clock window before SIGKILL (globalTimeoutMs + grace). */
    killAfterMs: number;
  };
}

interface HangInfo {
  hangDetected: true;
  globalTimeoutMs: number;
  killAfterMs: number;
}

async function tallyResults(jsonFile: string): Promise<NonNullable<SummaryJson['totals']>> {
  const empty = { passed: 0, failed: 0, skipped: 0, flaky: 0, expected: 0 };
  try {
    const raw = await readFile(jsonFile, 'utf8');
    const parsed = JSON.parse(raw) as {
      stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number };
    };
    const stats = parsed.stats ?? {};
    return {
      passed: stats.expected ?? 0,
      failed: stats.unexpected ?? 0,
      skipped: stats.skipped ?? 0,
      flaky: stats.flaky ?? 0,
      expected: stats.expected ?? 0,
    };
  } catch {
    return empty;
  }
}

async function writeSummary(
  outDir: string,
  cfg: ResolvedVantageConfig,
  exitCode: number,
  vantageVersion: string,
  totals: NonNullable<SummaryJson['totals']>,
  cadence: SummaryJson['cadence'],
  hang?: HangInfo
): Promise<void> {
  const summary: SummaryJson = {
    version: vantageVersion,
    finishedAt: new Date().toISOString(),
    cadence,
    exitCode,
    totals,
    config: {
      baseURL: cfg.baseURL,
      routesCount: cfg.routes.length,
      engines: cfg.engines,
      viewports: cfg.viewports,
      locale: cfg.locale,
      timezoneId: cfg.timezoneId,
    },
    disabledAxeRules: cfg.axeDisabled,
    ...(hang ? { hang } : {}),
  };
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

interface GateManifestOptions {
  lastRunDir: string;
  gateDir: string;
  cfg: ResolvedVantageConfig;
  vantageVersion: string;
  project: string;
  surface: string | undefined;
  verbose: boolean;
}

interface GateManifestOutcome {
  coverageComplete: boolean;
  missingRoutes: number[];
  manifestSha256: string;
}

/**
 * Read the per-route sidecar records the gate spec wrote, assemble them
 * into the ordered deterministic `gate-manifest.json`, and report coverage.
 *
 * The runner — NOT the spec — assembles the final manifest so ordering is
 * deterministic (by authoritative route index, not Playwright's parallel
 * capture order) and the binding hash is computed in exactly one place. A
 * missing sidecar (worker crashed before writing, or zero tests matched)
 * is surfaced via `coverageComplete: false` so the caller can fail closed.
 */
async function assembleGateManifest(opts: GateManifestOptions): Promise<GateManifestOutcome> {
  const records: GateRouteRecord[] = [];
  for (let i = 0; i < opts.cfg.routes.length; i++) {
    const route = opts.cfg.routes[i]!;
    const sidecar = path.join(opts.gateDir, `gate-route-${i}.json`);
    if (!existsSync(sidecar)) continue;
    let parsed: GateRouteRecord;
    try {
      parsed = JSON.parse(await readFile(sidecar, 'utf8')) as GateRouteRecord;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A corrupt sidecar leaves this slot missing → coverage incomplete → fail-closed.
      process.stderr.write(`[vantage] gate: failed to read sidecar ${sidecar}: ${msg}\n`);
      continue;
    }
    // Route IDENTITY is runner-authoritative, never trusted from sidecar content:
    // reject any sidecar whose claimed index/name/path does not match the
    // authoritative route for THIS slot. This stops a corrupt, stale, or spoofed
    // sidecar from claiming a different route, duplicating one, or riding a green
    // coverage with a manifest whose records don't correspond to cfg.routes
    // (the manifest is the binding evidence for the external gate). The capture
    // fields (DOM / screenshot / axe / render-health) are taken from the sidecar;
    // the identity (index / name / path) is re-stamped from cfg.routes.
    if (parsed.index !== i || parsed.name !== route.name || parsed.path !== route.path) {
      process.stderr.write(
        `[vantage] gate: sidecar ${sidecar} identity mismatch ` +
          `(claimed index=${String(parsed.index)} name=${String(parsed.name)} path=${String(parsed.path)}; ` +
          `expected index=${i} name=${route.name} path=${route.path}); rejecting (fail-closed).\n`
      );
      continue;
    }
    records.push({ ...parsed, index: i, name: route.name, path: route.path });
  }

  const manifest = assembleManifest(
    {
      vantageVersion: opts.vantageVersion,
      finishedAt: new Date().toISOString(),
      surface: opts.surface,
      project: opts.project,
      a11yGating: opts.cfg.gateA11yGating ?? false,
    },
    records,
    opts.cfg.routes.length
  );

  const manifestPath = path.join(opts.lastRunDir, 'gate-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  if (opts.verbose) {
    process.stderr.write(
      `[vantage] gate: wrote ${manifestPath} ` +
        `(routes ${manifest.routes.length}/${manifest.routeCount}, ` +
        `manifestSha256=${manifest.manifestSha256})\n`
    );
  }

  return {
    coverageComplete: manifest.coverageComplete,
    missingRoutes: manifest.missingRoutes,
    manifestSha256: manifest.manifestSha256,
  };
}

async function linkOrRedirect(lastRunDir: string, htmlReportDir: string): Promise<void> {
  const target = path.join(lastRunDir, 'index.html');
  const reportIndex = path.join(htmlReportDir, 'index.html');
  if (!existsSync(reportIndex)) return;
  const rel = path.relative(lastRunDir, reportIndex).split(path.sep).join('/');
  try {
    if (existsSync(target)) await rm(target);
    // Use the relative path as the symlink target so the link survives if
    // the user copies or moves .vantage/last-run/ wholesale.
    await symlink(rel, target, 'file');
  } catch {
    // Windows non-elevated case: write a redirect stub.
    const redirect = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${rel}"><title>vantage last-run report</title><p>Opening <a href="${rel}">${rel}</a> &hellip;</p>`;
    await writeFile(target, redirect, 'utf8');
  }
}

export interface TeardownOptions {
  rawConfig: ResolvedVantageConfig;
  consumerCwd: string;
  verbose: boolean;
}

/**
 * `vantage teardown` subcommand: invokes cfg.auth.teardown if set,
 * then deletes the cached storageState. Idempotent — missing
 * storageState file is not an error. Useful as a safety net after a
 * test run leaves stale session cookies behind, or as a manual step
 * before a fresh dev session.
 */
export async function runTeardown(opts: TeardownOptions): Promise<number> {
  const { rawConfig: cfg, consumerCwd, verbose } = opts;
  if (!cfg.auth) {
    process.stderr.write(
      'vantage teardown: no `auth` block configured. Nothing to tear down.\n'
    );
    return 0;
  }
  const storageStatePath = resolveStorageStatePath(cfg.auth, consumerCwd);
  if (cfg.auth.teardown) {
    const teardownPath = path.isAbsolute(cfg.auth.teardown)
      ? cfg.auth.teardown
      : path.join(consumerCwd, cfg.auth.teardown);
    if (!existsSync(teardownPath)) {
      process.stderr.write(
        `vantage teardown: auth.teardown module not found at ${teardownPath}\n`
      );
      return 2;
    }
    if (verbose) {
      process.stderr.write(`[vantage] invoking auth teardown ${teardownPath}\n`);
    }
    try {
      const fn = await importDefaultFn(teardownPath, consumerCwd);
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[vantage] auth teardown threw: ${msg}\n`);
      return 4;
    }
  }
  if (existsSync(storageStatePath)) {
    await unlink(storageStatePath);
    if (verbose) {
      process.stderr.write(`[vantage] removed cached storageState ${storageStatePath}\n`);
    }
  }
  return 0;
}

function resolveStorageStatePath(auth: VantageAuth, consumerCwd: string): string {
  const rel = auth.storageStatePath ?? path.join('.vantage', 'auth', 'storageState.json');
  return path.isAbsolute(rel) ? rel : path.join(consumerCwd, rel);
}

async function ensureAuthStorageState(
  auth: VantageAuth,
  consumerCwd: string,
  verbose: boolean
): Promise<string> {
  const storageStatePath = resolveStorageStatePath(auth, consumerCwd);

  let needRefresh = !existsSync(storageStatePath);
  if (!needRefresh && auth.expirySeconds !== undefined) {
    try {
      const stats = await stat(storageStatePath);
      const ageSec = (Date.now() - stats.mtimeMs) / 1000;
      if (ageSec > auth.expirySeconds) {
        needRefresh = true;
        if (verbose) {
          process.stderr.write(
            `[vantage] cached storageState is ${Math.round(ageSec)}s old (> ${auth.expirySeconds}s expiry); refreshing\n`
          );
        }
      }
    } catch {
      needRefresh = true;
    }
  }

  if (!needRefresh) {
    if (verbose) {
      process.stderr.write(`[vantage] reusing cached storageState ${storageStatePath}\n`);
    }
    return storageStatePath;
  }

  const setupPath = path.isAbsolute(auth.setup)
    ? auth.setup
    : path.join(consumerCwd, auth.setup);
  if (!existsSync(setupPath)) {
    throw new EnvError(
      `auth.setup module not found at ${setupPath}. ` +
        'Set cfg.auth.setup to a path relative to your project root, or an absolute path.'
    );
  }
  if (verbose) {
    process.stderr.write(`[vantage] running auth setup ${setupPath}\n`);
  }
  const setupFn = await importDefaultFn(setupPath, consumerCwd);
  const state = await setupFn();
  if (state === null || typeof state !== 'object') {
    throw new EnvError(
      `auth.setup at ${setupPath} returned ${typeof state} — expected a Playwright storageState object ` +
        '(see https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state).'
    );
  }
  await mkdir(path.dirname(storageStatePath), { recursive: true });
  let serialised: string;
  try {
    serialised = JSON.stringify(state, null, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EnvError(
      `auth.setup at ${setupPath} returned a value that is not JSON-serialisable: ${msg}. ` +
        'Ensure cookies/localStorage entries are plain strings/numbers (no BigInt, no circular refs).'
    );
  }
  // Write to a sibling .tmp file then atomic rename so concurrent
  // vantage runs in the same checkout cannot interleave a
  // half-written JSON that a Playwright worker would later fail to
  // parse when constructing a context with storageState.
  const tmpPath = `${storageStatePath}.tmp`;
  await writeFile(tmpPath, serialised, 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, storageStatePath);
  return storageStatePath;
}

/**
 * Import the default export of `modPath` and require it to be a
 * function. Supports .ts/.mts via tsx and .js/.mjs natively.
 */
async function importDefaultFn(modPath: string, consumerCwd: string): Promise<() => unknown> {
  const ext = path.extname(modPath).toLowerCase();
  let mod: { default?: unknown } & Record<string, unknown>;
  if (ext === '.ts' || ext === '.mts') {
    const tsx = (await dynamicImportPreferringConsumer('tsx/esm/api', consumerCwd)) as {
      register: () => () => Promise<void>;
    };
    const url = pathToFileURL(modPath).href;
    // register() + import(), NOT tsImport(): tsImport's `?namespace=<id>`
    // query is appended to module paths resolved inside the setup module,
    // which breaks require()-of-ESM resolution in CJS-shaped consumers
    // (same defect as the config loader in bin/vantage.mjs — see there).
    const unregister = tsx.register();
    try {
      mod = (await import(url)) as typeof mod;
    } finally {
      await unregister();
    }
  } else {
    mod = (await import(pathToFileURL(modPath).href)) as typeof mod;
  }
  // CJS-shaped consumers: the transpiled setup module arrives as
  // `{ default: { __esModule, default: fn } }` — unwrap the interop layer
  // so the checks below see the real default export.
  const inner = mod.default;
  if (
    inner &&
    typeof inner === 'object' &&
    (inner as { __esModule?: boolean }).__esModule &&
    'default' in inner
  ) {
    mod = inner as typeof mod;
  }
  if (typeof mod.default === 'function') {
    return mod.default as () => unknown;
  }
  // Common consumer mistake: named export only, no default. The
  // namespace object isn't callable; flagging this with a targeted
  // message saves a round of "but I exported it" debugging.
  if (mod.default === undefined) {
    const namedKeys = Object.keys(mod).filter((k) => k !== 'default');
    if (namedKeys.length > 0) {
      throw new EnvError(
        `${modPath} has no default export, only named export(s): ${namedKeys.join(', ')}. ` +
          'Change `export async function setupAuth() {...}` to `export default async function setupAuth() {...}`.'
      );
    }
    throw new EnvError(
      `${modPath} has no default export. ` +
        'Use `export default async function() { ... }` returning a Playwright storageState.'
    );
  }
  throw new EnvError(
    `${modPath} default export must be a function returning a storageState. Got: ${typeof mod.default}.`
  );
}

async function dynamicImportPreferringConsumer(
  specifier: string,
  consumerCwd: string
): Promise<unknown> {
  try {
    const consumerRequire = createRequire(path.join(consumerCwd, 'package.json'));
    const resolved = consumerRequire.resolve(specifier);
    return await import(pathToFileURL(resolved).href);
  } catch {
    const selfRequire = createRequire(import.meta.url);
    const resolved = selfRequire.resolve(specifier);
    return await import(pathToFileURL(resolved).href);
  }
}

export interface ListOptions {
  rawConfig: ResolvedVantageConfig;
  args: ParsedArgs;
}

/**
 * Render the engine x viewport x spec matrix without running it.
 */
export function renderMatrix(opts: ListOptions): string {
  const cfg = applyRunFlagsToConfig(opts.rawConfig, opts.args);
  const baseSpecs = ['smoke', 'a11y', 'keyboard', 'emulated-media', 'virtual-sr'];
  const releaseSpecs = ['nvda', 'lighthouse', 'html-validate'];
  const specs = opts.args.visual
    ? ['visual']
    : opts.args.gate
      ? ['gate']
      : opts.args.release
        ? [...baseSpecs, ...releaseSpecs]
        : baseSpecs;
  const rows: string[] = [];
  rows.push('vantage matrix:');
  rows.push(`  baseURL:    ${cfg.baseURL}`);
  rows.push(`  routes:     ${cfg.routes.map((r) => r.name).join(', ')}`);
  rows.push(`  engines:    ${cfg.engines.join(', ')}`);
  rows.push(`  viewports:  ${cfg.viewports.join(', ')}`);
  rows.push(`  specs:      ${specs.join(', ')}`);
  rows.push('');
  rows.push('  projects (engine__viewport):');
  for (const e of cfg.engines) {
    for (const v of cfg.viewports) {
      rows.push(`    - ${e}__${v}`);
    }
  }
  rows.push('');
  rows.push(`  total tests ~ engines(${cfg.engines.length}) x viewports(${cfg.viewports.length}) x specs(${specs.length}) x routes(${cfg.routes.length})`);
  return rows.join('\n');
}

function quote(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}
