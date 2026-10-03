import type { PlaywrightTestConfig } from '@playwright/test';

export type EngineName = 'chromium' | 'firefox' | 'webkit';

export type ViewportName = 'mobile-320' | 'mobile-375' | 'tablet-768' | 'desktop-1280' | 'desktop-1920';

/**
 * One route under test. `name` is used in test titles + report grouping.
 * `path` is appended to the consumer's baseURL.
 *
 * `lighthouseThresholds`, if set, overrides the suite-wide thresholds for
 * this route only — merged per-category so omitted fields fall back to
 * the suite-wide value (and then to the defaults). Use this to relax
 * perf on a heavy dashboard route without lowering the floor for the
 * whole site, or to tighten a11y on a landing page where the budget
 * justifies a higher bar.
 */
export interface VantageRoute {
  name: string;
  path: string;
  lighthouseThresholds?: VantageLighthouseThresholds;
}

/**
 * Web server launched by Playwright before tests run. Set to `false` to
 * skip server launch (e.g. when running against a public URL or an
 * externally-managed server).
 */
export interface VantageWebServer {
  command: string;
  url?: string;
  port?: number;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * axe rules a consumer wants suppressed. Logged loudly in the report header
 * so disabled rules can never silently hide.
 */
export interface VantageAxeDisabled {
  rule: string;
  reason: string;
}

/**
 * Lighthouse score thresholds for the `--release` cadence. Each value is
 * the MINIMUM acceptable score (0–100). Categories above the threshold
 * pass; below fails. Defaults: perf 75, a11y 95, best-practices 85, seo 90.
 *
 * `pwa` is accepted for backwards compatibility with older Lighthouse
 * configurations, but the PWA category is deprecated in Lighthouse 12+
 * (and may produce no score in Lighthouse 13+, in which case the
 * threshold is silently a no-op). Avoid relying on it for new configs.
 */
export interface VantageLighthouseThresholds {
  performance?: number;
  accessibility?: number;
  'best-practices'?: number;
  seo?: number;
  /** @deprecated PWA category is gated behind experimental presets in Lighthouse 12+. */
  pwa?: number;
}

/**
 * Network throttling preset applied to smoke.spec.ts and a11y.spec.ts.
 *
 * Implemented via Chromium DevTools Protocol (`Network.emulateNetworkConditions`)
 * — so it ONLY takes effect on chromium projects. On firefox / webkit the
 * helper emits a one-time console.warn and the test runs at full bandwidth.
 *
 * Named presets resolve as:
 *   `3g-slow`: 400 down / 400 up kbps, 400 ms latency (Lighthouse "Slow 3G")
 *   `3g-fast`: 1638 down / 768 up kbps, 150 ms latency (Lighthouse "Fast 3G")
 *   `4g`:      9000 down / 9000 up kbps, 170 ms latency
 *   `wifi`:    30000 down / 15000 up kbps, 2 ms latency
 *
 * `--release` Lighthouse audits IGNORE this setting — Lighthouse runs its
 * own simulated throttling for accurate perf budgets and we don't want
 * the two to compete.
 */
export type VantageNetworkPresetName = '3g-slow' | '3g-fast' | '4g' | 'wifi';
export interface VantageNetworkPresetCustom {
  downloadKbps: number;
  uploadKbps: number;
  latencyMs: number;
}
export type VantageNetworkPreset = VantageNetworkPresetName | VantageNetworkPresetCustom;

/**
 * Auth lifecycle hooks. `setup` is the path (relative to the consumer's
 * project root, or absolute) of a JS/TS module that returns a Playwright
 * storageState object — vantage imports it, calls its default export,
 * caches the returned state, and wires it into every project's
 * `use.storageState`. `teardown`, if set, runs after the suite finishes
 * and on the explicit `vantage teardown` subcommand.
 *
 * `storageStatePath` is where the captured state is persisted between
 * runs; default `.vantage/auth/storageState.json` under the consumer's
 * cwd. `expirySeconds`, if set, forces a re-run of `setup` when the
 * cached state is older than that age — useful for short-lived session
 * tokens.
 */
export interface VantageAuth {
  setup: string;
  teardown?: string;
  storageStatePath?: string;
  expirySeconds?: number;
}

/**
 * Consumer-facing configuration. Authored as vantage.config.ts in the
 * consuming project root.
 */
export interface VantageConfig {
  /** Base URL of the site under test (e.g. http://127.0.0.1:3000). */
  baseURL: string;

  /** Routes to test against `baseURL`. At least one required. */
  routes: VantageRoute[];

  /**
   * Web server to launch. Must be set explicitly to either a config object
   * (vantage starts the server) or `false` (consumer manages the server
   * themselves, e.g. running against a remote URL).
   */
  webServer: VantageWebServer | false;

  /**
   * Engines under test. Default: all three.
   */
  engines?: EngineName[];

  /**
   * Viewport profiles under test. Default: all five.
   */
  viewports?: ViewportName[];

  /**
   * Extra regex patterns appended to the default console-ignore list.
   * Anything matching is ignored when smoke.spec asserts no console errors.
   * Concatenated with defaults, not replaced.
   */
  consoleIgnore?: RegExp[];

  /**
   * axe rules disabled in a11y.spec. Each entry MUST include a `reason`;
   * disabled rules render in a loud header at the top of every report.
   */
  axeDisabled?: VantageAxeDisabled[];

  /**
   * If set, smoke.spec waits for this selector to appear before asserting
   * page readiness. Recommended pattern: emit `<div data-test-ready>` from
   * your app when it has finished hydrating / fetching. Default unset:
   * vantage waits for `domcontentloaded` only.
   */
  readyMarker?: string;

  /**
   * Locale forwarded to Playwright contextOptions. Default 'en-GB'.
   */
  locale?: string;

  /**
   * timezoneId forwarded to Playwright contextOptions. Default 'Europe/London'.
   */
  timezoneId?: string;

  /**
   * Lighthouse score thresholds. Only consulted on `--release`. If unset,
   * vantage uses perf 75, a11y 95, best-practices 85, seo 90. Per-route
   * overrides via `VantageRoute.lighthouseThresholds` take precedence
   * over this suite-wide value (merged per-category).
   */
  lighthouseThresholds?: VantageLighthouseThresholds;

  /**
   * Visual regression settings. Only consulted on `--visual`. The visual
   * spec runs `expect(page).toHaveScreenshot()` for each route on a
   * single project (default `chromium__desktop-1280`). Baselines are
   * managed by the consumer — vantage ships none. See README for the
   * Windows ClearType escape hatch (`snapshotPathTemplate`).
   *
   * `visualProject` selects which engine__viewport project the visual
   * spec runs on; defaults to `chromium__desktop-1280`. Any value that
   * does not match one of the generated project names skips the spec
   * loudly.
   *
   * `visualThreshold` is the maxDiffPixelRatio passthrough — 0.0 means
   * exact match, 1.0 means tolerate any change. Default 0.01.
   */
  visualProject?: string;
  visualThreshold?: number;

  /**
   * `--gate` cadence: whether axe (a11y) violations are GATING.
   *
   * Render-health failures (non-2xx, blank render, uncaught page errors,
   * console problems, failed requests) always fail the gate cadence — that
   * floor is universal. Accessibility, by contrast, is audience-toggled:
   *
   *   - Internal surfaces (e.g. an operator cockpit): set `false` (default).
   *     axe still runs and its findings are recorded in the manifest for
   *     information, but they do NOT fail the run.
   *   - Customer-facing surfaces: set `true`. axe violations fail the gate
   *     cadence exactly like the `a11y` spec, making accessibility a
   *     first-class release gate.
   *
   * Only consulted under `--gate`. Default `false` (record-but-non-gating).
   */
  gateA11yGating?: boolean;

  /**
   * Authenticated-route lifecycle. Set to wire a setup hook that
   * produces a storageState (cookies + localStorage), which vantage
   * caches and passes to every Playwright project.
   */
  auth?: VantageAuth;

  /**
   * Apply CDP-based network throttling to smoke.spec and a11y.spec. See
   * {@link VantageNetworkPreset}. Chromium-only — vantage warns
   * once and proceeds at full bandwidth on firefox / webkit.
   *
   * NOT wired into keyboard / emulated-media / virtual-sr (bandwidth
   * does not affect their signal) or lighthouse.spec (Lighthouse runs
   * its own simulated throttling).
   */
  networkPreset?: VantageNetworkPreset;

  /**
   * Run html-validate against the raw HTTP response body (via Node `fetch`)
   * in ADDITION to the post-hydration DOM pass, on `--release`. Default
   * false. When true, each route produces two independent test cases:
   * `markup on $name ($path) (post-hydration)` and
   * `markup on $name ($path) (raw response)`.
   *
   * **Title-shape side effect**: enabling this flag changes the
   * post-hydration test title from the v0.4 shape `markup on $name ($path)`
   * to `markup on $name ($path) (post-hydration)` so the two passes
   * are disambiguated in the report. CI dashboards keyed on the v0.4
   * full title will not match the new shape — switch to a prefix
   * match on `markup on $name ($path)` if you enable this flag.
   *
   * Closes the carry-forward "html-validate runs against post-hydration
   * DOM only" — the post-hydration pass misses SSR markup bugs that the
   * client rewrites before assertion. The raw-response pass catches
   * them.
   *
   * Auth interaction — by design: the raw fetch does NOT forward
   * `cfg.auth` storageState cookies (they live in the browser context,
   * not in Node `fetch`). If a route requires auth, the raw fetch
   * receives the unauthenticated response. A 2xx login page is validated;
   * a non-2xx response (such as 401) fails as a route failure before any
   * markup verdict. Surfacing the login flow's markup is exactly
   * what makes raw-response useful for authenticated routes, since
   * post-hydration validation never reaches the unauthenticated first
   * paint. Do not file as a bug.
   *
   * Redirects: Node `fetch` follows by default (`redirect: 'follow'`).
   * vantage inherits that — matches what html-validate would see in a
   * browser.
   */
  htmlValidateRaw?: boolean;

  /**
   * Additional spec globs to treat as release-only — appended to
   * vantage's built-in release-only spec list (nvda, lighthouse,
   * html-validate) and applied via project-level `testIgnore`. Matched
   * files are excluded from every project EXCEPT
   * `chromium__desktop-1280` (the release-supported project).
   *
   * NOTE: Playwright matches `testIgnore` globs against files
   * discovered under the active `testDir`. vantage's `testDir` is its
   * own bundled specs dir, so these patterns only do anything if the
   * consumer's spec files are ALSO discoverable there (typically via
   * `playwrightOverrides.testDir` or `testMatch`). For consumer specs
   * that live in a separate root, gate them yourself using
   * `process.env.VANTAGE_RELEASE === '1'` inside your own
   * `playwrightOverrides`.
   */
  releaseOnlyPatterns?: string[];

  /**
   * Escape hatch for advanced consumers — extra Playwright config merged
   * into the generated config last. Use sparingly; vantage may override.
   */
  playwrightOverrides?: Partial<PlaywrightTestConfig>;

  /**
   * Wall-clock upper bound (in milliseconds) for the whole Playwright
   * run, inclusive of all engines × viewports × specs × routes. vantage
   * applies this as Playwright's `globalTimeout` AND wraps the spawned
   * Playwright child with a SIGKILL after `runnerTimeoutMs + 90_000`
   * (a 90 s grace window so Playwright still has time to shut down
   * workers, flush the JSON reporter, and exit on its own when
   * `globalTimeout` fires).
   *
   * The SIGKILL belt is necessary because Playwright worker-pool
   * shutdown can deadlock on multi-engine multi-viewport runs (notably
   * WebKit on Windows). When that happens the parent process exits with
   * code 4 (RUNTIME_ERROR) and writes a `summary.json` whose
   * `hangDetected: true` flag documents the SIGKILL — so a consumer
   * scripting on summary.json can detect and report the hang
   * deterministically.
   *
   * If unset, vantage picks a cadence-aware default:
   *   --smoke    →  5 min  (300_000 ms)
   *   --visual   → 30 min  (1_800_000 ms)
   *   default    → 30 min  (1_800_000 ms)
   *   --release  → 60 min  (3_600_000 ms — Lighthouse + NVDA inflate)
   *
   * Setting this explicitly overrides the cadence default for ALL
   * cadences in the same run. To set per-cadence caps, branch on
   * `process.argv` in your `vantage.config.ts` before returning.
   */
  runnerTimeoutMs?: number;
}

/**
 * Defaults-applied, validated form of `VantageConfig`. Internal.
 */
export interface ResolvedVantageConfig {
  baseURL: string;
  routes: VantageRoute[];
  webServer: VantageWebServer | false;
  engines: EngineName[];
  viewports: ViewportName[];
  consoleIgnore: RegExp[];
  axeDisabled: VantageAxeDisabled[];
  readyMarker?: string;
  locale: string;
  timezoneId: string;
  lighthouseThresholds?: VantageLighthouseThresholds;
  visualProject?: string;
  visualThreshold?: number;
  gateA11yGating?: boolean;
  auth?: VantageAuth;
  networkPreset?: VantageNetworkPreset;
  releaseOnlyPatterns?: string[];
  htmlValidateRaw?: boolean;
  playwrightOverrides?: Partial<PlaywrightTestConfig>;
  runnerTimeoutMs?: number;
}
