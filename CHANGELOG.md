# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `--no-reuse` and `--ci` now use runner-owned webServer launch and child-bound
  readiness: refuse a foreign listener, reject child exit before readiness,
  and prevent an advertised relocated port from satisfying the configured URL.
  The command's process tree is cleaned up after the run. Silent-command
  degradation and the accepted post-GREEN race are documented in README.

- Failed route responses now stop content checks with a route-specific HTTP
  diagnostic, including raw-response HTML validation, instead of reporting
  accessibility or markup defects in the server's error page.

- Renamed the tool from Preflight to Vantage before launch: package name,
  CLI binary, config convention, environment variables, generated artifacts,
  docs, templates, CI labels, and public TypeScript identifiers now use
  `vantage`/`Vantage`/`VANTAGE_*`.

## [0.7.0] - 2026-06-07

Adds a `--gate` cadence: a trusted capture mode for an external CI
review gate that needs to bind a verdict to a *runner-produced*
rendering of a surface, never to model-claimed evidence. It renders a
route set on one project and emits a deterministic
`gate-manifest.json` — ordered per-route records (post-hydration DOM
hash, screenshot, axe summary, render-health) plus a binding overall
hash. The DOM hash is load-bearing; the screenshot is recorded for
vision review but deliberately excluded from the binding hash (PNG
bytes flake on Windows ClearType hinting). Render-health always gates;
a11y is audience-toggled via the new `gateA11yGating` field.

### Added

- **`--gate` cadence.** Runs only the new gate spec on a single
  project and writes `.vantage/last-run/gate-manifest.json`: an
  ordered `[{ index, name, path, status, renderHealth, domSha256,
  domPath, screenshotSha256, screenshotPath, axe }]` plus a binding
  `manifestSha256`, `coverageComplete`, and `missingRoutes`. The
  binding hash is computed over the DOM + axe summary + render-health
  with order-insensitive arrays sorted, so it is stable across renders
  of a deterministic surface and a checker can recompute it. Screenshot
  bytes are excluded from the binding hash.

- **Inert-JSON-only config for `--gate`.** The gate cadence requires an
  explicit `--config <file.json>` and never auto-discovers or executes
  a `vantage.config.ts`. The config is parsed as data, not imported as
  code — so the route set under test comes from the trusted gate driver,
  not from PR-controlled code. A missing config, a non-`.json` config,
  or unparseable JSON is rejected with exit code 2 (CONFIG_ERROR).

- **`gateA11yGating` config field.** Audience-toggles whether axe (a11y)
  violations fail the `--gate` cadence. Default `false` (record-but-
  non-gating, for internal surfaces); set `true` for customer-facing
  surfaces to make accessibility a first-class release gate. Render-
  health failures (non-2xx, blank render, uncaught page errors, console
  problems, failed requests) gate regardless of this setting.

- **Fail-closed gate coverage.** If an authoritative route produces no
  capture (worker crash, zero matched tests), `coverageComplete` is
  `false`, the missing route indices are listed in `missingRoutes`, and
  the run exits 1 even if Playwright itself reported success — a
  silently-incomplete surface never reads as a green gate.

## [0.6.1] - 2026-05-27

Fixes a default-cadence hang where a multi-engine multi-viewport run
could deadlock during Playwright worker-pool shutdown (the
`worker-N process did not exit within 300000ms after stop` warning
followed by indefinite hang post-test-completion). vantage v0.6.0
inherited this Playwright sharp edge with no recovery — the runner
awaited Playwright's child exit with no wall-clock bound, and the
generated config never set `globalTimeout`. v0.6.1 adds both bounds
(belt + braces) and a `hangDetected` flag in `summary.json` so CI
consumers can detect a forced kill deterministically.

### Fixed

- **Default cadence wall-clock cap.** Every Playwright run now has an
  upper bound. The runner forwards `globalTimeout` to the generated
  Playwright config AND wraps the spawned child with a SIGKILL after
  `globalTimeout + 90_000` ms grace. On expiry: SIGTERM, 10 s grace,
  SIGKILL, 5 s grace, parent resolves with exit code 4
  (RUNTIME_ERROR) and writes `summary.json` with
  `hang: { hangDetected: true, globalTimeoutMs, killAfterMs }`. The
  90 s grace exists so a healthy globalTimeout fire (Playwright exits
  on its own, flushes the JSON reporter, finalises the HTML report)
  is not interrupted by the parent's belt-and-braces kill.

  Per-cadence defaults:

  | Cadence       | Default `globalTimeout` |
  | ------------- | ----------------------- |
  | `--smoke`     | 5 min                   |
  | default       | 30 min                  |
  | `--visual`    | 30 min                  |
  | `--release`   | 60 min                  |

  Why the v0.6.0 hang surfaced now: Playwright's WebKit worker pool
  shutdown can deadlock on Windows when ~15 projects (3 engines × 5
  viewports) run in parallel. The individual tests completed; the
  shutdown of one worker called into a webkit process that never
  acknowledged stop(). v0.6.0 had no recovery from this — the
  parent runner blocked on child exit indefinitely. With the new
  caps, the run exits within `runnerTimeoutMs + 90 s` regardless of
  Playwright's worker-pool state.

### Added

- **`runnerTimeoutMs` config field.** Override the cadence default
  with an explicit wall-clock cap in milliseconds. Applies to every
  cadence in the same run; to set per-cadence overrides, branch on
  `process.argv` inside `vantage.config.ts` before returning. Must
  be a positive finite number; rejected at config-validation time
  with a clear error otherwise.

  ```ts
  // vantage.config.ts
  export default defineConfig({
    baseURL: 'http://127.0.0.1:3000',
    routes: [{ name: 'home', path: '/' }],
    webServer: false,
    runnerTimeoutMs: 20 * 60 * 1000, // 20 min for every cadence
  });
  ```

- **`summary.json` `hang` field.** Set iff the wall-clock cap fired.
  Shape: `{ hangDetected: true, globalTimeoutMs, killAfterMs }`.
  Omitted entirely on healthy runs so backwards-compatible CI
  consumers that key on a missing field continue to work; consumers
  who want hang detection check `summary.hang?.hangDetected === true`.

- **`scripts/simulate-hung-child.mjs`.** Reviewer-runnable integration
  check that spawns a sleep-forever Node child and runs it through
  the same SIGTERM → SIGKILL escalation logic as `runPlaywright()`.
  Exits 0 on the expected `{ exitCode: 4, hangDetected: true }`
  result; non-zero otherwise. Total wall-clock ~17 s. Run via
  `node scripts/simulate-hung-child.mjs`. Not shipped in the npm
  tarball (`files` in `package.json` does not include `scripts/`).

### Changed

- `vantage --help` now documents the wall-clock cap and the
  `runnerTimeoutMs` config field under a new `WALL-CLOCK CAP`
  section. Exit code 4 (RUNTIME_ERROR) now explicitly includes the
  wall-clock-hang case in its description.

- README "Exit codes" table notes that exit 4 covers wall-clock hangs;
  new "Wall-clock cap" subsection under Cadence documents the per-
  cadence defaults and the `runnerTimeoutMs` override.

## [0.6.0]

Adds CI for vantage's own repo and clears the operator-decide
carry-forward: the maintainer has no Mac dev box in the validation
loop and no plans to add one, so VoiceOver moves from "deferred,
re-ask next chunk" to "documented future work without committed
cadence". vantage is at a stable resting state as of this tag.

### Added

- `.github/workflows/ci.yml` gating `main` and PRs. Builds the
  TypeScript, packs the tarball, installs into a fresh scratch dir
  next to `@playwright/test` (peerDep), installs Chromium (cached),
  and runs `npx vantage --smoke --ci` against a static fixture
  under `ci/fixture/`. Matrix: `ubuntu-latest` + `windows-latest` for
  smoke; `macos-latest` runs build-only (compile-clean signal; no
  smoke without a Mac dev box). On smoke failure, uploads
  `.vantage/last-run/` as a 7-day artefact.

- `ci/fixture/index.html` — minimal deterministic page used by the
  CI smoke job. Valid markup, focusable elements, no axe violations
  under the default ruleset. Consumers can read it as a reference
  for what a smoke-passing page looks like.

### Changed

- No consumer-facing API changes. v0.6 is repo-internal
  release-quality work — future regressions in the published tarball
  surface at PR time rather than at consumer install time.

## [0.5.0]

Adds two carry-forward closures from v0.3/v0.4 and a Windows
quality-of-life fix: SSR raw-response html-validate pass behind a new
config flag, an opinionated default `snapshotPathTemplate` so visual
baselines land inside the consumer's project, and a lychee `.cmd`-shim
fallback for Scoop installs. macOS VoiceOver remains deferred to v0.6+
(still no Mac dev box in the validation loop).

### Added

- `htmlValidateRaw` config field (boolean, default `false`). When
  enabled, `html-validate.spec` emits TWO independent test cases per
  route under `--release`: a post-hydration pass (existing
  `page.content()` behaviour) and a new raw-response pass that fetches
  the route via Node `fetch` and validates the response body directly.
  The raw pass catches SSR markup bugs the browser normalises before
  the post-hydration pass observes them (e.g. lowercase `<!doctype>`).
  Documented as surfacing-by-design for authenticated routes: the raw
  fetch does NOT carry `cfg.auth` storageState cookies, so the response
  body is the unauthenticated first-paint markup — exactly the signal
  the post-hydration pass cannot reach.

- Default `snapshotPathTemplate` for `--visual`. Without configuration,
  baselines now land at `${consumerRoot}/__vantage_screenshots__/{arg}{ext}`
  — outside `node_modules/`, ready to check in, survives `npm install`.
  Consumer-supplied `playwrightOverrides.snapshotPathTemplate` still
  wins via the spread mechanic; use an absolute path or `{testDir}`-
  prefixed template to override.

### Changed

- `markup on $name ($path)` test title (the existing html-validate
  release pass) is unchanged when `htmlValidateRaw` is `false`. When
  the flag is `true`, the two passes use `markup on $name ($path) (post-hydration)`
  and `markup on $name ($path) (raw response)` to disambiguate.

### Fixed

- **lychee `.cmd`-shim ENOENT on Windows.** Scoop and npm-installed
  lychee on Windows register as `lychee.cmd`. v0.4's bare
  `spawn('lychee', ...)` couldn't resolve PATHEXT, so Scoop-only
  installs got "command not found" even though lychee was installed.
  v0.5 retries through cmd.exe on Windows when the primary spawn
  ENOENTs, letting PATHEXT resolve to `.cmd`. The `.exe` primary path
  is unchanged. Applied to both the main `lychee` invocation and the
  `--version` compatibility probe.

  The retry uses `shell: true`, which trips Node's DEP0190 deprecation
  warning ("args are not escaped, only concatenated"). The args list is
  config-derived (`baseURL` + `route.path`) and is not sanitised against
  cmd-metacharacters — acceptable trade-off for the retry path only;
  documented in README known-issues.

## [0.4.0]

Adds the three highest-leverage v0.4 deliverables: Chromium-CDP network
throttling, consumer-registered release-only specs, and a lychee
minimum-version diagnostic. macOS VoiceOver remains deferred (needs a
Mac dev box in the validation loop); SSR raw-response html-validate and
default `snapshotPathTemplate` deferred to v0.5+.

### Added

- `networkPreset` config field — applies Chromium DevTools Protocol
  `Network.emulateNetworkConditions` to `smoke.spec` and `a11y.spec`.
  Accepts a named preset (`'3g-slow' | '3g-fast' | '4g' | 'wifi'`) or
  a custom `{ downloadKbps, uploadKbps, latencyMs }` object.
  **Chromium-only** — firefox / webkit emit a one-time stderr warning
  and proceed at full bandwidth. Not wired into keyboard / emulated-media
  / virtual-sr (signal does not depend on bandwidth) or
  `lighthouse.spec` (Lighthouse runs its own simulated throttling).

- `releaseOnlyPatterns` config field — array of additional spec globs
  appended to vantage's built-in release-only list (`nvda`,
  `lighthouse`, `html-validate`). Receives the same project-level
  `testIgnore` treatment: matched files are excluded from every
  Playwright project except `chromium__desktop-1280`. Patterns are
  matched against files discovered under vantage's `testDir`, so
  consumer specs in a separate root must self-gate via
  `process.env.VANTAGE_RELEASE === '1'` inside their own
  `playwrightOverrides`.

- `--links` now pre-flights `lychee --version` and warns to stderr if
  the installed lychee is older than 0.13.0. vantage uses
  `--no-progress`, `--max-concurrency`, and `--timeout`; older builds
  may not support all three. Parse failure emits a softer warning and
  proceeds — never blocks the run.

### Carried forward (still applicable)

- `--release` workers:1 single-threading (NVDA foreground-app constraint).
- NVDA `spokenPhraseLog()` empty-string behaviour on silent-driver dev boxes.
- Lighthouse free-port TOCTOU window (fix-pin via `VANTAGE_LIGHTHOUSE_PORT`).
- example.com validation thin — network throttling validated locally
  against scratch fixture for stronger wallclock signal.
- Visual baselines default location, `--visual` sequential execution,
  `auth.setup` parent-process import cost, `auth` paths not sandboxed,
  `teardown` unconditional cache delete — all v0.3 carry-forwards
  unchanged.

## [0.3.0]

Adds the two highest-leverage v0.3 deliverables: visual regression
(opt-in `--visual` cadence) and authenticated-route helpers
(`storageState` lifecycle). Also generalises Lighthouse thresholds
per-route. macOS VoiceOver and consumer-registered release-only specs
deferred to v0.4+.

### R5 remediation (post-reviewer)

- Lighthouse spec now honours `cfg.auth.storageState` — without this
  patch, the spec's own browser launch (CDP requirement) ignored
  Playwright's project-level `use.storageState`, so an authenticated
  route would have redirected to /login during `--release` and
  Lighthouse would have scored the login page.
- `--visual` testMatch/testIgnore gate is now applied AFTER any
  `playwrightOverrides` spread, so a consumer with custom
  `testMatch` (e.g. to register a project-side spec) cannot silently
  break the visual cadence.
- `--visual` + `--smoke` / `--visual` + `--engine` / `--visual` +
  `--release` are now hard-rejected at the CLI boundary with a
  conflict message naming the incompatible flags, instead of producing
  a silent-skip exit-0 run.
- `defineConfig` rejects duplicate route names with a route-grouping
  reason in the error — collisions would silently overwrite each
  other's visual baselines.
- `auth.setup` cache writes are now atomic (`.tmp` → rename) so
  concurrent vantage runs against the same checkout can't interleave
  a half-written JSON file.
- `auth.setup` modules without a default export get a targeted error
  naming the named exports they have and the exact code change to
  make. Previously the error read "must export a default async
  function ... Got: object" — confusing because the named function
  WAS present.
- Non-JSON-serialisable storageState (BigInt cookie expiries, circular
  refs) now surfaces with a consumer-actionable EnvError instead of an
  opaque V8 TypeError.
- `--engine=safari` / `--reporter=junitxml` (typos / wrong values) are
  rejected at parseArgs with `unknown argument` instead of producing a
  confusing "no project found" deep in Playwright.
- `webServer.cwd` is pre-resolved in the runner so playwright.config.ts
  no longer depends on `process.cwd()` semantics; fixes a latent v0.1
  bug where consumers with a webServer (not webServer:false) would have
  had the server cwd silently default to `node_modules/vantage/dist/`
  instead of their project root.

### Added

- `--visual` cadence: runs only `visual.spec.ts` on one project
  (default `chromium__desktop-1280`, override via `cfg.visualProject`).
  Uses Playwright's `toHaveScreenshot()` with `maxDiffPixelRatio`
  controlled by `cfg.visualThreshold` (default 0.01). Baselines are
  consumer-managed — vantage ships none. README documents the
  Windows ClearType escape hatch with a worked `snapshotPathTemplate`
  recipe encoding `os.release()` so each Windows build keys its own
  baseline tree.
- `cfg.auth` field: setup module produces a Playwright `storageState`,
  vantage caches it to `.vantage/auth/storageState.json` (override
  via `auth.storageStatePath`), expires per `auth.expirySeconds`, and
  wires the path into every project's `use.storageState`. `--no-auth`
  bypasses setup for a single run.
- `vantage teardown` subcommand: invokes `cfg.auth.teardown` (if
  set) and deletes the cached storageState. Safety net for the v0.1
  carry-forward "storageState reuse will break tests" gotcha.
- `VantageRoute.lighthouseThresholds`: per-route override layered on
  top of suite-wide thresholds, per-category. Partially addresses the
  v0.2 "Lighthouse defaults assume ship-gate" known-issue.
- `summary.json` `cadence` discriminator now includes `'visual'`
  alongside `'smoke' | 'full' | 'release' | 'links'`.
- Six new README sections: per-route Lighthouse override, auth setup
  walkthrough, visual cadence + `--visual` capture/compare workflow,
  Windows ClearType escape hatch worked example, `--no-auth` /
  `vantage teardown` documentation, v0.4+ roadmap (VoiceOver,
  network throttling, consumer-registered release specs).

### Changed

- README: coverage matrix now lists visual regression as shipping and
  authenticated routes as shipping; v0.3 roadmap → v0.4+ roadmap.
- CLI help text adds `--visual`, `--no-auth`, `teardown` subcommand.

### Known limitations

- Visual baselines default to `node_modules/vantage/dist/specs/`
  (Playwright's default sibling-of-spec location), which is destroyed
  on `npm install`. Consumers MUST set
  `playwrightOverrides.snapshotPathTemplate` to a path within their
  own repo. README documents this.
- `auth.setup` runs in the parent runner process before the Playwright
  child is spawned — if the setup module imports heavy dependencies,
  vantage startup latency increases.
- `auth.storageStatePath` and `auth.setup` are not path-sandboxed; a
  consumer-authored config can read/write outside the project root
  (their own machine, their choice). Documented as such.
- `--release` workers:1 single-threading unchanged from v0.2 (NVDA
  foreground-app constraint).
- NVDA `spokenPhraseLog()` still empty on Guidepup's silent driver —
  spec captures phrases as a soft artefact rather than asserting on
  them. Unchanged from v0.2.
- lychee minimum-version diagnostic deferred to v0.4 (carry-forward
  from v0.2 known-issues).
- html-validate post-hydration-only behaviour unchanged from v0.2.

## [0.2.0]

Adds the install-risk-surface features deferred from v0.1: real NVDA,
Lighthouse budgets, html-validate, lychee link-check, and a CI workflow
template. Two new cadences (`--release`, `--links`) keep the heavier
work off the per-push hot path.

### R5 remediation (post-reviewer)

- Release-only specs are now gated at the Playwright project level
  via `testIgnore` rather than only inside the test body. This stops
  non-supported projects from spawning a worker just to skip — more
  importantly, it prevents the NVDA fixture from being constructed
  in parallel across 15 projects, which would race on Windows kernel
  hooks before the skip check could fire.
- Lychee runner streams stdout/stderr directly to
  `.vantage/last-run/lychee-output.txt` instead of accumulating in
  V8 heap. Prevents OOM on link-checks of large sites.
- `summary.json` now carries a `cadence` discriminator
  (`smoke|full|release|links`) and unified nullable shape across all
  cadences. CI consumers reading the file MUST switch on `cadence`
  before interpreting `totals` / `engines` / `disabledAxeRules`.
- NVDA spec lazy-imports `@guidepup/playwright` inside the
  isRelease + isWindows branch — non-Windows release runs no longer
  even touch the package.
- GHA template: lychee install via official `lycheeverse/lychee-action@v2`
  (version-pinned, handles asset-naming changes); release job has
  `timeout-minutes: 5` on guidepup-setup plus a defensive `Test-Path`
  check before invoking it.
- `lighthouseThresholds.pwa` marked `@deprecated` in the type; PWA
  category is gated behind experimental presets in Lighthouse 12+.

### Added

- `--release` flag: runs the default suite PLUS real-NVDA (via Guidepup,
  Windows-only), Lighthouse perf/a11y/best-practices/seo budgets
  (Chromium-only), and html-validate strict markup linting. Each new
  spec gates itself on platform / engine / project so a single-shot
  `--release` does not multiply across the full engine x viewport matrix.
  The NVDA spec captures NVDA's spoken phrases under
  `.vantage/last-run/nvda-spoken-phrases.json` as a SOFT artefact —
  pass/fail is gated on NVDA starting and walking the routes without
  throwing, not on phrase-log content (which depends on the consumer's
  speech-synth driver and produces false positives if asserted on).
- `--links` flag: shells out to the lychee CLI for link checking,
  standalone (does not run Playwright at all). Respects a
  `lychee.toml` in the consumer project root.
- `vantage init --ci`: additionally drops a starter
  `.github/workflows/vantage.yml` covering all four cadences
  (smoke per-push, full on PR, release on tag, links nightly).
- `lighthouseThresholds` config field with documented defaults
  (perf 75, a11y 95, best-practices 85, seo 90). Per-category override.
- `scripts/setup-guidepup.ps1`: wrapper around `@guidepup/setup` for
  Windows hosts, with documented cold-install caveats and a fallback
  to the consumer's installed copy.
- Five new README gotchas: Guidepup cold-install surface area, dev vs.
  built-artefact for `--release`, ClearType subpixel hinting, cadence
  discipline, `.vantage/last-run/` as the canonical CI artefact path.

### Changed

- README: optional v0.2 extras install section; CLI table now
  includes `--release` / `--links` / `init --ci`; coverage matrix
  now lists NVDA / Lighthouse / html-validate / lychee as shipping;
  roadmap moved to v0.3.

### Known limitations

- Guidepup's downloaded NVDA build lives in `%TEMP%` — Storage Sense
  can wipe it, leaving a stale HKCU pointer. Re-run setup.
- Lighthouse spec launches its own browser (CDP requirement). It does
  not honour `playwrightOverrides` for browser launch args.
- html-validate runs against post-hydration HTML only; SSR-specific
  markup bugs that only appear on the raw response body are missed.
- lychee CLI is a separate install (not an npm package); vantage
  shells to it from PATH.

## [0.1.0]

Initial release. Local-only web-assurance scaffolding for any web project.

### Added

- `vantage` CLI (`bin/vantage.mjs`) with documented exit codes
  (0 OK, 1 test failure, 2 config error, 3 environment error, 4 runtime).
- `defineConfig({ ... })` helper with runtime schema validation:
  unknown top-level keys are rejected loudly so typos do not silently
  alter test runs.
- Playwright project matrix across three engines (Chromium, Firefox,
  WebKit) and five viewport profiles (mobile-320, mobile-375 = iPhone 13,
  tablet-768 = iPad gen 7, desktop-1280, desktop-1920).
- Default locale `en-GB` and timezone `Europe/London`, both overridable
  in consumer config.
- Spec suite: `smoke` (HTTP 2xx, console errors, page errors, failed
  requests), `a11y` (axe-core WCAG 2.0/2.1/2.2 A+AA),
  `keyboard` (Tab walk + focus-indicator), `emulated-media` (reduced
  motion, dark / light, prefers-contrast, forced-colors, print),
  `virtual-sr` (in-page accessible-name sweep — flags interactive
  elements with no name a screen reader could announce).
- Default console-error ignore-list: adblocker-blocked analytics,
  framework deprecation warnings, browser-extension noise. Consumer
  `consoleIgnore` is concatenated, never replaces.
- axe rule disable mechanism that requires a `reason` per rule; disabled
  rules render in a loud banner at the top of every HTML report and in
  `.vantage/last-run/disabled-axe-rules.md`.
- `.vantage/last-run/` stable output directory: HTML report, JSON,
  JUnit (`--ci`), `summary.json`, and a convenience `index.html` (symlink
  or redirect fallback on Windows).
- CLI flags: `--smoke`, `--list`, `--only`, `--engine`, `--headed`,
  `--debug`, `--verbose`, `--update-snapshots`, `--reporter`, `--config`,
  `--ci`, `--no-reuse`.
- `vantage init [--force]` drops a starter `vantage.config.ts`;
  refuses to clobber without `--force`.
- Loads consumer `vantage.config.ts` via `tsx` (declared as a regular
  dep so consumers do not need their own TS loader).
- README sections: install, quick start, coverage table, iOS manual
  smoke checklist, exit codes, CLI surface, 10 documented gotchas, v0.2
  roadmap, honest "what vantage does NOT cover" list.

### Known limitations

- Playwright WebKit is engine-close, not behaviour-identical to iOS
  Safari. Manual real-device QA still required.
- No authenticated route helpers in v0.1.
- No real network throttling.
- Virtual screen reader only; real NVDA arrives in v0.2.
- `npx playwright install` downloads ~650 MB of browser binaries.

[Unreleased]: https://example.com/CHANGELOG
[0.6.1]: https://example.com/CHANGELOG#0-6-1
[0.6.0]: https://example.com/CHANGELOG#0-6-0
[0.5.0]: https://example.com/CHANGELOG#0-5-0
[0.4.0]: https://example.com/CHANGELOG#0-4-0
[0.3.0]: https://example.com/CHANGELOG#0-3-0
[0.2.0]: https://example.com/CHANGELOG#0-2-0
[0.1.0]: https://example.com/CHANGELOG#0-1-0
