import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineName, ResolvedVantageConfig } from './types.js';
import { buildViewportProfiles, type ViewportProfile } from './viewports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * vantage forwards the consumer's resolved config as JSON via env. RegExp
 * objects don't survive JSON round-trips, so consoleIgnore is serialised as
 * { source, flags } pairs and reconstructed here.
 */
interface SerialisedRegExp {
  source: string;
  flags: string;
}
interface SerialisedConfig extends Omit<ResolvedVantageConfig, 'consoleIgnore'> {
  consoleIgnore: SerialisedRegExp[];
  /** Resolved by runner.ts when cfg.auth is set and --no-auth wasn't passed. */
  storageStatePath?: string;
}

function loadConfigFromEnv(): ResolvedVantageConfig & { storageStatePath?: string } {
  const raw = process.env.VANTAGE_CONFIG_JSON;
  if (!raw) {
    throw new Error(
      'vantage: VANTAGE_CONFIG_JSON is not set. This config file is intended ' +
        'to be loaded by `bin/vantage.mjs`, not by `npx playwright test` directly.'
    );
  }
  const parsed = JSON.parse(raw) as SerialisedConfig;
  return {
    ...parsed,
    consoleIgnore: parsed.consoleIgnore.map((r) => new RegExp(r.source, r.flags)),
  };
}

const cfg = loadConfigFromEnv();
const profiles = buildViewportProfiles();
const isCi = process.env.VANTAGE_CI === '1';
const isRelease = process.env.VANTAGE_RELEASE === '1';
const isVisual = process.env.VANTAGE_VISUAL === '1';
const isGate = process.env.VANTAGE_GATE === '1';

/**
 * Wall-clock upper bound for the whole Playwright run. The runner
 * computes this in the parent process (cadence-aware default, override-
 * able via cfg.runnerTimeoutMs) and forwards it via env so this config
 * file does not need to know about cadence flags.
 *
 * Playwright's `globalTimeout` doc: "Total time spent by the whole test
 * run. If exceeded, the runner exits and reports the time used as the
 * cause of the failure." Without this set, a deadlocked worker
 * shutdown (e.g. WebKit-on-Windows on multi-engine runs) leaves
 * Playwright stuck post-test-completion with no recovery — the bug
 * v0.6.1 fixes.
 *
 * The parent runner also enforces this as a SIGKILL bound after
 * `globalTimeoutMs + 90_000` ms (belt + braces; the grace window
 * lets Playwright shut down naturally when globalTimeout fires).
 */
const globalTimeoutMs = parsePositiveInt(process.env.VANTAGE_GLOBAL_TIMEOUT_MS);

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/**
 * Release-only spec files. These are gated to one supported project
 * (NVDA cannot tolerate parallel sessions; Lighthouse is Chromium-only;
 * html-validate runs against post-hydration DOM which is engine-agnostic).
 * We exclude the files at project level via `testIgnore` so non-supported
 * projects never even load them — that avoids spawning a worker per project
 * just to immediately skip from inside the test body, and (critical for
 * NVDA) prevents the per-test `nvda` fixture from being constructed in
 * parallel across projects, which would race on Windows kernel hooks.
 *
 * Consumer-registered patterns via cfg.releaseOnlyPatterns are appended
 * to this list — they get the same project-level testIgnore treatment.
 * Note: testIgnore is matched against files DISCOVERED by testDir; see
 * the field's JSDoc for the consumer-spec-out-of-testDir caveat.
 */
const BUILT_IN_RELEASE_ONLY_SPECS = [
  '**/nvda.spec.js',
  '**/lighthouse.spec.js',
  '**/html-validate.spec.js',
];
// Concat unconditional — the per-project testIgnore is applied regardless
// of isRelease (matches how the built-in three are gated). Outside the
// release cadence the matched specs simply don't exist under vantage's
// testDir for non-supported projects, so the ignore is a no-op.
const RELEASE_ONLY_SPECS = [
  ...BUILT_IN_RELEASE_ONLY_SPECS,
  ...(cfg.releaseOnlyPatterns ?? []),
];
const RELEASE_SUPPORTED_PROJECT = 'chromium__desktop-1280';

/**
 * Visual regression spec is gated differently from release: --visual is
 * FLAG-driven (run only visual.spec.js, hide everything else) whereas
 * --release is PROJECT-driven (release specs only load on the
 * Chromium desktop-1280 project, the rest of the suite still runs). We
 * can't merge them into one map — they need opposite testMatch shapes.
 */
const VISUAL_SPEC = '**/visual.spec.js';

/**
 * Gate-manifest spec. Like --visual it is FLAG-driven: --gate runs ONLY
 * gate.spec.js (and the gate cadence collapses the matrix to one project
 * in the runner), and every other cadence excludes it. It is its own spec
 * because it captures runner-bound artefacts (DOM hash + screenshot + axe
 * + render-health) and writes a deterministic manifest — distinct work
 * from the visual baseline assertion.
 */
const GATE_SPEC = '**/gate.spec.js';

const engineUseMap: Record<EngineName, ReturnType<typeof devices.valueOf> extends infer T ? T : never> = {
  chromium: devices['Desktop Chrome']!,
  firefox: devices['Desktop Firefox']!,
  webkit: devices['Desktop Safari']!,
};

/**
 * Build the reporter array.
 *
 * vantage always emits an HTML report + a JSON report into
 * .vantage/last-run/ so reviewers have stable artefacts regardless of
 * console reporter choice. Under --ci we additionally emit a JUnit XML.
 * The console reporter is `list` by default; VANTAGE_REPERATER can
 * override to line/list/html/json/junit.
 *
 * We dedupe: if the user requests `--reporter=html` we DO NOT add a second
 * HTML reporter, since Playwright doesn't tolerate two writing to the
 * same outputFolder.
 */
function buildReporters(): NonNullable<PlaywrightTestConfig['reporter']> {
  const requested = (process.env.VANTAGE_REPORTER ?? 'list').toLowerCase();
  const reporters: NonNullable<PlaywrightTestConfig['reporter']> = [];

  // Console reporter (skip if user requested one of the artefact reporters
  // we add unconditionally — let those run alone, no console duplication).
  if (requested === 'line' || requested === 'list') {
    reporters.push([requested]);
  } else if (requested === 'html' || requested === 'json' || requested === 'junit') {
    // The user wants only the artefact reporter; we still add it below, just
    // skip a console one to keep stdout clean.
  } else {
    reporters.push(['list']);
  }

  reporters.push([
    'html',
    { open: 'never', outputFolder: process.env.VANTAGE_HTML_REPORT_DIR },
  ]);
  reporters.push(['json', { outputFile: process.env.VANTAGE_JSON_FILE }]);
  if (isCi) {
    reporters.push(['junit', { outputFile: process.env.VANTAGE_JUNIT_FILE }]);
  }
  return reporters;
}

function buildProjects(): PlaywrightTestConfig['projects'] {
  const projects: NonNullable<PlaywrightTestConfig['projects']> = [];
  for (const engine of cfg.engines) {
    const engineUse = engineUseMap[engine];
    // Firefox does not support isMobile/hasTouch/deviceScaleFactor on
    // newContext. We still vary the viewport size so responsive
    // breakpoints get exercised; touch/UA emulation is a no-op there.
    const supportsMobileEmulation = engine !== 'firefox';
    for (const vpName of cfg.viewports) {
      const profile: ViewportProfile = profiles[vpName];
      const useBlock: NonNullable<PlaywrightTestConfig['projects']>[number]['use'] = {
        ...engineUse,
        baseURL: cfg.baseURL,
        locale: cfg.locale,
        timezoneId: cfg.timezoneId,
        viewport: profile.viewport,
      };
      if (cfg.storageStatePath) {
        useBlock.storageState = cfg.storageStatePath;
      }
      if (supportsMobileEmulation) {
        if (profile.deviceScaleFactor !== undefined) useBlock.deviceScaleFactor = profile.deviceScaleFactor;
        if (profile.isMobile !== undefined) useBlock.isMobile = profile.isMobile;
        if (profile.hasTouch !== undefined) useBlock.hasTouch = profile.hasTouch;
        if (profile.userAgent) useBlock.userAgent = profile.userAgent;
      }
      const projectName = `${engine}__${vpName}`;
      // Project-level gating for the release-only specs. Non-supported
      // projects ignore the files entirely, which means: (a) they
      // don't spawn a worker just to skip from inside the test body,
      // and (b) the NVDA fixture is never constructed across multiple
      // projects in parallel, which would race on Windows kernel
      // hooks. Per-spec gating in the spec body is kept as a
      // defence-in-depth (covers consumer-added playwrightOverrides).
      const testIgnore =
        projectName === RELEASE_SUPPORTED_PROJECT ? undefined : RELEASE_ONLY_SPECS;
      // Firefox keeps its own desktop UA + DPR — mobile/touch emulation is
      // a no-op there, but the viewport size still exercises responsive CSS.
      projects.push({
        name: projectName,
        use: useBlock,
        testIgnore,
        metadata: {
          engine,
          viewport: vpName,
        },
      });
    }
  }
  return projects;
}

// Cadence-driven spec selection. Exactly one of these shapes applies:
//   --gate   → run ONLY gate.spec.js
//   --visual → run ONLY visual.spec.js
//   default  → run everything EXCEPT the two flag-driven specs above
// gate is checked first so --gate wins unambiguously (the flag conflict
// check already rejects --gate + --visual, but ordering keeps this total).
const SELECTED_TEST_MATCH = isGate
  ? [GATE_SPEC]
  : isVisual
    ? [VISUAL_SPEC]
    : ['**/*.spec.js'];
const SELECTED_TEST_IGNORE = isGate || isVisual ? undefined : [VISUAL_SPEC, GATE_SPEC];

const config: PlaywrightTestConfig = defineConfig({
  testDir: path.join(__dirname, 'specs'),
  // We compile .ts → .js, so the published surface matches .spec.js.
  // NOTE: testMatch/testIgnore are set AFTER `playwrightOverrides`
  // below — the visual-cadence gate is load-bearing and must win
  // against any consumer override.

  fullyParallel: true,
  forbidOnly: isCi,
  // Gate mode pins retries OFF. The gate spec writes each route's sidecar
  // (fixed `gate-route-<index>` filename) BEFORE asserting render-health, so a
  // retry of an unhealthy route would OVERWRITE its sidecar and a passing retry
  // would bind the healthy capture — masking the unhealthy evidence the
  // write-then-assert contract must preserve. One capture per route, no retries.
  retries: isGate ? 0 : isCi ? 2 : 0,
  // --release pins to one worker because NVDA owns the foreground app
  // — it captures keyboard via global Windows hooks and breaks if any
  // other process steals focus mid-test. The `testIgnore` gating
  // prevents the *fixture* from being constructed in parallel across
  // projects; this `workers: 1` is the second half of the same fix:
  // it prevents other-project workers from launching browsers and
  // stealing focus from NVDA. Both halves are required.
  workers: isRelease ? 1 : isCi ? 2 : undefined,
  // Wall-clock cap on the whole run. See globalTimeoutMs comment above.
  // Setting to `undefined` (the Playwright default) means "no bound", which
  // is the v0.6.0 behaviour that produced the hang bug — so we always
  // forward a value from the runner.
  globalTimeout: globalTimeoutMs,
  reporter: buildReporters(),

  use: {
    baseURL: cfg.baseURL,
    locale: cfg.locale,
    timezoneId: cfg.timezoneId,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  outputDir: process.env.VANTAGE_TEST_RESULTS_DIR,

  // Default snapshot baseline location. Playwright's out-of-the-box
  // default is `{testDir}/{testFilePath}-snapshots/{arg}{ext}`, which
  // for vantage resolves under `node_modules/vantage/dist/specs/`
  // — destroyed on every `npm install`. We default to a directory
  // inside the consumer's project so baselines survive reinstalls and
  // can be checked in.
  //
  // process.cwd() === consumerCwd here: the runner spawns Playwright
  // with `cwd: consumerCwd` (see src/cli/runner.ts runPlaywright).
  //
  // Override semantics:
  //   - Consumer's `playwrightOverrides.snapshotPathTemplate` (top-level
  //     scalar) WINS via the spread below — later-key-wins on the
  //     same key.
  //   - Consumer's `playwrightOverrides.expect.toHaveScreenshot.pathTemplate`
  //     (a sibling key, NOT the same key) does NOT replace this default;
  //     both apply (Playwright merges expect-level templates over the
  //     top-level one per assertion).
  //   - A consumer who sets only other top-level keys (e.g. `expect`,
  //     `timeout`) leaves this default in place — intentional.
  snapshotPathTemplate: path.join(
    process.cwd(),
    '__vantage_screenshots__',
    '{arg}{ext}'
  ),

  projects: buildProjects(),

  webServer:
    isGate || cfg.webServer === false
      ? undefined
      : {
          command: cfg.webServer.command,
          url: cfg.webServer.url,
          port: cfg.webServer.port,
          // cwd is pre-resolved to an absolute path by the runner — see
          // resolvedWebServer in src/cli/runner.ts. Defaulting here would
          // break if anyone ever invoked this config file outside of
          // bin/vantage.mjs, but loadConfigFromEnv() above already
          // throws in that case.
          cwd: cfg.webServer.cwd,
          timeout: cfg.webServer.timeout ?? 120_000,
          env: cfg.webServer.env,
          reuseExistingServer: process.env.VANTAGE_OWNED_WEB_SERVER === '1' ||
            (!isCi && process.env.VANTAGE_NO_REUSE !== '1'),
          stdout: 'pipe',
          stderr: 'pipe',
        },

  // --gate uses an inert JSON config and a pinned Playwright contract. The
  // CLI and runner reject playwrightOverrides before this file is loaded, but
  // keep this child-process backstop so a future direct invocation cannot
  // smuggle globalSetup/reporters/webServer/testDir/use/etc. into gate mode.
  ...(isGate ? {} : (cfg.playwrightOverrides ?? {})),

  // The cadence testMatch/testIgnore is load-bearing — a consumer who sets
  // `playwrightOverrides.testMatch` (e.g. to register an extra custom spec)
  // would otherwise silently break --visual / --gate gating. Re-apply AFTER
  // the spread so the cadence selection always wins. Consumers who genuinely
  // want a different visual-cadence shape can set `cfg.visualProject`
  // (changes which project the spec runs on) — they don't need to
  // override testMatch.
  testMatch: SELECTED_TEST_MATCH,
  testIgnore: SELECTED_TEST_IGNORE,

  // In --gate mode the rendered engine×viewport project is collapsed to one
  // and bound into manifestSha256. Re-apply it AFTER the playwrightOverrides
  // spread (same reason as testMatch/testIgnore above) so a JSON config's
  // `playwrightOverrides.projects` cannot run the gate on a different/extra
  // project while the manifest still binds the planned one — which would also
  // collide the route-indexed sidecar filenames across projects. Outside gate
  // mode, projects overrides remain a legitimate consumer escape hatch.
  ...(isGate ? { projects: buildProjects() } : {}),
});

export default config;
