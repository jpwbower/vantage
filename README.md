# vantage

Local-only web-assurance scaffolding for any web project.

`vantage` wires together [Playwright](https://playwright.dev/) and [axe-core](https://github.com/dequelabs/axe-core) into a single CLI you can drop into any web project. It runs against your own dev server (or any URL), produces inspection-ready artefacts under `.vantage/last-run/`, and asks for no SaaS account, no cloud credit, and no telemetry. The audience is any developer building a website who wants a base-level local browser-assurance harness without paying for a SaaS audit tool.

This is **scaffolding**, not magic. vantage catches a floor of common regressions (HTTP failures, console errors, axe violations, missing focus indicators, broken accessibility names, broken media emulations). It does not replace real-device QA, paid accessibility audits, or human review.

---

## Install

Pin to a tag, not floating `main`:

```sh
npm i -D github:<your-org>/vantage#v0.3.0
npx playwright install
```

The `npx playwright install` step downloads Chromium, Firefox, and WebKit (~650 MB total) from Playwright's CDN. On Windows 11, Defender Real-time Protection may scan during download; a corporate firewall may block CDN access. Run it once on a network that allows the download.

`tsx` is pulled in automatically so your `vantage.config.ts` is loaded without a separate build step.

### Optional v0.2 extras

The heavier `--release` and `--links` cadences need additional installs. They're devDeps in vantage itself but not auto-bundled — install whichever you actually run:

```sh
# For `vantage --release` (NVDA + Lighthouse + html-validate):
npm i -D @guidepup/guidepup @guidepup/playwright @guidepup/setup \
         lighthouse playwright-lighthouse html-validate

# For NVDA specifically (Windows only): also run setup ONCE per machine.
node node_modules/@guidepup/setup/bin/setup

# For `vantage --links` (lychee CLI — NOT an npm package):
#   macOS:    brew install lychee
#   Windows:  scoop install lychee   (or `cargo install lychee`)
#   Linux:    cargo install lychee   (or download from GitHub releases)
```

Each spec degrades gracefully — if its dep is missing or NVDA isn't set up, the spec skips with a clear message instead of crashing.

---

## Quick start

```sh
npx vantage init           # drops vantage.config.ts in your CWD
npx vantage init --ci      # additionally drops .github/workflows/vantage.yml
# edit baseURL, routes, webServer
npx vantage --smoke        # chromium-only mobile-375 smoke + a11y smoke
npx vantage                # full default suite (3 engines x 5 viewports x 5 specs)
npx vantage --release      # full + nvda (Windows) + lighthouse + html-validate
npx vantage --links        # lychee link checker (standalone)
npx vantage --visual       # visual regression on one project (opt-in cadence)
```

Every run writes to `.vantage/last-run/`:

```
.vantage/last-run/
├── html-report/index.html      # Playwright HTML report
├── results.json                # full Playwright JSON
├── junit.xml                   # (--ci) JUnit reporter
├── disabled-axe-rules.md       # loud list of any disabled axe rules
├── summary.json                # pass/fail counts + config snapshot
└── index.html                  # convenience redirect to the report
```

Add `.vantage/` to your `.gitignore`.

---

## Coverage

| Engine / behaviour                     | vantage covers? |
| -------------------------------------- | ----------------- |
| Chromium (Blink) latest                | yes — Playwright bundles it |
| Firefox (Gecko) latest                 | yes — Playwright bundles it |
| WebKit (Apple's engine)                | engine, not Safari behaviour — see below |
| iOS Safari real device                 | NO — manual checklist below |
| macOS Safari real device               | NO — manual smoke recommended |
| Android Chrome real GPU                | NO — Chromium engine only |
| Older browser versions                 | NO |
| NVDA screen reader                     | yes — on `--release`, Windows only (Guidepup) |
| Lighthouse perf/a11y/seo budgets       | yes — on `--release`, Chromium only |
| `html-validate` strict markup linting  | yes — on `--release` |
| Link checking (lychee)                 | yes — on `--links`, separate cadence |
| Visual regression (toHaveScreenshot)   | yes — on `--visual`, baselines consumer-managed |
| JAWS screen reader                     | NO — manual / paid audit |
| Authenticated routes                   | yes — `cfg.auth` storageState lifecycle (v0.3) |
| Real network throttling                | NO — synthetic Chromium CDP only |
| Print stylesheets                      | yes |
| Reduced motion / dark mode             | yes (all engines) |
| Forced colours                         | yes (Chromium only) |
| Increased contrast                     | yes (Chromium + Firefox where supported) |

---

## iOS smoke checklist (manual, pre-launch)

vantage's WebKit project is engine-close, not behaviour-identical to iOS Safari. Run this on a real iPhone before launch:

1. Rotate device portrait↔landscape; layout does not break.
2. Open the on-screen keyboard on a form input; `100vh` does not get clipped behind it.
3. Scroll past the bottom (rubber-band); fixed-position elements do not drift.
4. Tap a button without `cursor: pointer`; verify tap feedback (`touch-action`, `-webkit-tap-highlight-color`).
5. Toggle Dark Mode in Settings; the site reacts within 1 s.
6. Open in Safari Private mode; no broken storage assumptions (no silent `localStorage` errors).
7. Print-preview a page (Share → Print); the print stylesheet is honoured.
8. Enable VoiceOver; focus order matches visual order; every interactive element announces a name.
9. Pinch-zoom in and out; text and tap targets remain usable.
10. Toggle Settings → Accessibility → Motion → Reduce Motion; animations are suppressed.

---

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0    | All checks passed |
| 1    | Test failure (assertion / smoke / a11y violation at fail-threshold) |
| 2    | Config error (your `vantage.config.ts` is invalid) |
| 3    | Environment error (vantage's `dist/` missing, or `@playwright/test` peer dep not installed) |
| 4    | Runtime error (uncaught throw OR wall-clock hang — see "Wall-clock cap" below) |

`--ci` flips: console **warnings** escalate to failures alongside errors.

---

## CLI

```
vantage                       full default suite
vantage --smoke               chromium-only, mobile-375 viewport, smoke + a11y smoke
vantage --release             full + nvda + lighthouse + html-validate
vantage --links               lychee link check only (skips Playwright)
vantage --visual              visual regression on one project (skips other specs)
vantage --gate --config <f.json>  trusted CI-gate capture: deterministic per-route manifest
vantage init [--force]        drop a starter vantage.config.ts
vantage init --ci             additionally drop .github/workflows/vantage.yml
vantage list                  print the engine x viewport x spec matrix; do not run
vantage teardown              run cfg.auth.teardown + delete cached storageState
vantage --list                alias for the `list` subcommand
vantage --only=<route>        scope to one configured route (matches route.name)
vantage --engine=<name>       chromium | firefox | webkit
vantage --headed              non-headless browsers (debugging)
vantage --debug               PWDEBUG=1 passthrough (Playwright Inspector)
vantage --verbose             verbose progress logs
vantage --update-snapshots    Playwright snapshot update passthrough
vantage --reporter=<name>     line | list | html | json | junit
vantage --config=<path>       override config discovery
vantage --ci                  strict defaults: html + junit reporters, fail on warnings, no reuseExistingServer
vantage --no-reuse            force a fresh webServer launch (debug stuck server)
vantage --no-auth             skip cfg.auth.setup even if configured
```

### Cadence

The cadences exist so each test pays its wallclock cost at the right moment:

| Flag           | When to run            | Wallclock target | Covers |
| -------------- | ---------------------- | ---------------- | ------ |
| `--smoke`      | every push             | < 60 s           | smoke + a11y smoke, chromium + mobile-375 only |
| (default)      | PR open / push to main | 1–5 min          | full engine x viewport matrix of v0.1 specs |
| `--release`    | pre-tag, before publish | 5–20 min         | full + NVDA (Windows) + Lighthouse (Chromium) + html-validate |
| `--links`      | nightly cron           | depends on site  | lychee against the configured routes; no browser launch. v0.4 warns if lychee is older than 0.13.0. |
| `--visual`     | opt-in (consumer choice) | depends on site | toHaveScreenshot per route on one project; baselines consumer-managed |
| `--gate`       | driven by an external CI gate | depends on site | one project × all routes; emits a deterministic per-route manifest (see below) |

### Gate cadence (`--gate`)

`--gate` is a **trusted capture** cadence for a CI gate that needs to bind a
verdict to a *runner-produced* rendering of a surface — not to evidence a
reviewer claims. It renders a route set on **one project** and writes a
deterministic `.vantage/last-run/gate-manifest.json`:

```jsonc
{
  "schemaVersion": "1",
  "manifestSha256": "…",          // binding hash over the ordered route records
  "coverageComplete": true,        // false ⇒ a route produced no capture (fail closed)
  "a11yGating": false,             // echoes cfg.gateA11yGating
  "routes": [
    {
      "index": 0, "name": "home", "path": "/", "status": 200,
      "renderHealth": { "ok": true, "blank": false, "domTextLength": 336,
                        "pageErrors": [], "consoleErrors": [], "failedRequests": [] },
      "domSha256": "…",            // post-hydration DOM hash (load-bearing)
      "domPath": "gate/gate-route-0.dom.html",
      "screenshotSha256": "…",     // provenance only — NOT in the binding hash
      "screenshotPath": "gate/gate-route-0.png",
      "axe": { "violationCount": 0, "violations": [] }
    }
  ]
}
```

Key properties:

- **Inert JSON config only.** `--gate` requires an explicit
  `--config <file.json>` staged outside the current project checkout and
  **never** auto-discovers or executes a `vantage.config.ts`. The route set
  under test comes from the trusted gate driver as data, not from PR-controlled
  code. A non-`.json` config, a relative path, or an absolute path inside the
  checkout is refused.
- **Gate JSON is a strict inert subset.** Allowed top-level keys are:
  `baseURL`, `routes`, `webServer`, `engines`, `viewports`, `readyMarker`,
  `locale`, `timezoneId`, `gateA11yGating`, `networkPreset`, and
  `runnerTimeoutMs`. `auth`, `playwrightOverrides`, `releaseOnlyPatterns`,
  `consoleIgnore`, `axeDisabled`, and non-gate release/visual fields fail with
  `CONFIG_ERROR` rather than being silently ignored. `webServer` must be
  `false`; the trusted gate runner starts the surface out-of-band and the JSON
  points `baseURL` at that already-running server.
- **The DOM hash is load-bearing; the screenshot is not.** `manifestSha256` is
  computed over the post-hydration DOM + axe summary + render-health (with
  order-insensitive arrays sorted), so it is **stable across renders of a
  deterministic surface** and a checker can recompute it. Screenshot bytes are
  recorded for vision review + file integrity but are **excluded** from the
  binding hash — full-page PNGs flake on Windows ClearType hinting regardless of
  any code change.
- **Render-health always gates; a11y is audience-toggled.** A non-2xx status,
  blank render, uncaught page error, console problem, or failed request fails
  the cadence (exit 1) — but the route is still recorded in the manifest first
  (write-then-assert). axe violations gate **only** when `gateA11yGating: true`
  (customer-facing surfaces); the default `false` records axe findings for
  information without failing the run (internal surfaces).
- **Single deterministic project, bound into the hash.** Defaults to
  `chromium__desktop-1280`; narrow `engines`/`viewports` to one each in the JSON
  config, or pass `--engine`, to change it (the rendered project is logged when a
  multi-project config is collapsed). The project is part of `manifestSha256`, so
  two renders that used different projects can never collide on a matching hash.
- **Determinism is a precondition of the surface, not a guarantee.** The binding
  hash is stable only for a surface whose post-hydration DOM is itself stable. A
  surface that emits hydration nonces, randomized IDs (`:r1:`-style framework
  IDs), timestamps, or content that lands after the settle window will produce a
  different `domSha256` per render — for such a surface the manifest is an
  **inspection aid**, and the gate should rest on the vision + mechanical-floor
  layers rather than the content hash. (A static, deterministic build is the case
  the binding hash is designed for.)

```bash
npx vantage --gate --config /absolute/path/outside/checkout/gate-config.json
```

`--gate` is the engine an external review gate drives (build + serve the surface
in an isolated environment, then render twice and compare `manifestSha256` to
catch nondeterminism). On its own it is a faithful, fail-closed capture tool.

> **Security.** The inert JSON config is parsed as data and checked against the
> gate allowlist, never imported as code. That closes config-provided module
> hooks (`auth.setup`, `globalSetup`, custom reporters/specs, etc.) and
> config-provided shell commands (`webServer.command`). The JSON still chooses
> the route set and policy data, so the `--config` path must always be
> **driver-controlled**, never a path a PR can write. vantage rejects relative
> paths and realpathed absolute paths inside the current project checkout;
> provenance of the staged file remains the gate runner's responsibility.

### Wall-clock cap

Every cadence has an upper wall-clock bound. If Playwright doesn't
exit within the cap, vantage SIGKILLs the spawned child + exits
with code 4 (RUNTIME_ERROR) + writes `summary.json` with
`hang: { hangDetected: true, globalTimeoutMs, killAfterMs }`. This
exists because Playwright's worker-pool shutdown can deadlock on
multi-engine multi-viewport runs (notably WebKit on Windows) —
without a cap, the parent runner would block forever on child exit.

| Cadence       | Default cap |
| ------------- | ----------- |
| `--smoke`     | 5 min       |
| `--gate`      | 15 min      |
| (default)     | 30 min      |
| `--visual`    | 30 min      |
| `--release`   | 60 min      |

Override per-config via `runnerTimeoutMs` (number of milliseconds):

```ts
// vantage.config.ts
export default defineConfig({
  baseURL: 'http://127.0.0.1:3000',
  routes: [{ name: 'home', path: '/' }],
  webServer: false,
  runnerTimeoutMs: 20 * 60 * 1000, // 20 min for ALL cadences in this run
});
```

To set per-cadence overrides, branch on `process.argv` inside
`vantage.config.ts` before returning the config object — vantage
imports the file at startup and inspects the resolved value.

The cap is enforced in two places (belt + braces):
1. **Playwright `globalTimeout`** — the runner forwards
   `runnerTimeoutMs` (or the cadence default) into the generated
   Playwright config. Playwright honours this on healthy runs and
   exits cleanly.
2. **Parent SIGKILL after `runnerTimeoutMs + 90_000` ms grace** —
   covers the case where Playwright itself is deadlocked and never
   acts on `globalTimeout`. The 90 s grace lets a healthy
   globalTimeout fire shut down workers, flush the JSON reporter,
   and finalise the HTML report before the parent escalates.

CI consumers wanting to detect a forced kill check
`summary.hang?.hangDetected === true`. On healthy runs the `hang`
field is omitted entirely, so older consumers that don't know about
the field continue to work.

---

## Gotchas

These are the rough edges to know about before you wire vantage into CI.

### v0.6 additions

- **GitHub Actions CI for vantage itself.** The repo now has its
  own `.github/workflows/ci.yml` gating `main` and PRs. On every
  push: TypeScript compiles, the tarball packs, installs into a
  fresh scratch dir as a sibling of `@playwright/test`, and
  `npx vantage --smoke` runs against a static fixture under
  `ci/fixture/`. Matrix runs on `ubuntu-latest` + `windows-latest`;
  a separate `macos-latest` job builds + packs (no smoke — no Mac
  dev box in the validation loop) to catch any accidental
  Linux/Windows-only API use.

  No consumer-facing API change in v0.6 — this is repo-internal
  release-quality work. Future regressions in the published tarball
  or in the smoke / a11y specs should now surface at PR time
  instead of at the next consumer install.

### v0.5 additions

- **SSR raw-response html-validate pass (`cfg.htmlValidateRaw`).** Closes
  the v0.4 carry-forward "html-validate runs against post-hydration DOM
  only". Set `cfg.htmlValidateRaw: true` and the `--release`
  html-validate spec runs TWO independent passes per route:

  ```
  markup on home (/) (post-hydration)   ← page.content()
  markup on home (/) (raw response)     ← Node fetch + response.text()
  ```

  Default is `false`; when off, the test title preserves the v0.4 shape
  `markup on $name ($path)` so existing CI dashboards keyed on the title
  continue to work.

  The raw-response pass catches SSR markup bugs the browser normalises
  before the post-hydration pass sees them — for example, a `<!doctype html>`
  (lowercase) in the SSR response is normalised to `<!DOCTYPE html>` by
  the parser, so only the raw pass surfaces the `doctype-style` rule
  violation.

  **Auth interaction — by design.** The raw fetch does NOT forward
  `cfg.auth` storageState cookies (they live in the browser context,
  not Node `fetch`). For authenticated routes, the raw pass receives the
  unauthenticated response. A 2xx login page is validated; non-2xx
  responses (such as 401) fail as route failures before a markup verdict.
  This is useful because the post-hydration pass never sees the SSR markup
  served before the redirect. Do not file as a bug; that's the whole
  point of having a separate raw-response pass for authenticated routes.

- **Default `snapshotPathTemplate` for `--visual`.** Closes the v0.3
  carry-forward "visual baselines default to
  `node_modules/vantage/dist/specs/visual.spec.js-snapshots/`". Without
  configuration, baselines now land at
  `{your-project-root}/__vantage_screenshots__/{arg}{ext}` — outside
  `node_modules/`, survives `npm install`, ready to check in.

  A consumer-supplied `playwrightOverrides.snapshotPathTemplate` still
  wins (the spread mechanic overrides the default cleanly). Use an
  absolute path or a `{testDir}`-prefixed template if you set your own
  override — bare relative paths resolve against Playwright's
  `testDir`, which for vantage is its bundled specs dir inside
  `node_modules/`.

- **lychee `.cmd`-shim fallback on Windows.** Scoop/npm-installed lychee
  on Windows registers as `lychee.cmd`. v0.4 spawned `lychee` directly
  without `shell: true`, which doesn't resolve PATHEXT — Scoop-only
  installs got "command not found" even though lychee was on PATH. v0.5
  retries the `--links` spawn through cmd.exe on Windows when the bare
  `lychee` ENOENTs, which lets PATHEXT resolve to `.cmd`. The `.exe`
  primary path (cargo / brew / manual installs) is unchanged and does
  not go through the shell.

  Caveat: Node emits a DEP0190 deprecation warning on the .cmd-retry
  path ("arguments are not escaped, only concatenated"). The args list
  is config-derived (`baseURL` + `route.path`) and is not sanitised
  against cmd-metacharacters (`&`, `|`, `^`, etc.). The threat model is
  "consumer attacks their own machine via their own config" — acceptable
  for the .cmd-shim retry, but if you're paranoid, install lychee via
  `cargo install lychee` or place a manual `lychee.exe` on PATH to keep
  the spawn off the shell entirely.

### v0.4 additions

- **Network throttling via Chromium CDP (`networkPreset`).** v0.4 wires
  Playwright's CDP `Network.emulateNetworkConditions` into smoke.spec
  and a11y.spec, exposed as a top-level `networkPreset` config field.
  Accepts a named preset (`'3g-slow' | '3g-fast' | '4g' | 'wifi'`) or a
  custom `{ downloadKbps, uploadKbps, latencyMs }` object.

  ```ts
  export default defineConfig({
    baseURL: 'http://127.0.0.1:3000',
    routes: [{ name: 'home', path: '/' }],
    webServer: false,
    networkPreset: '3g-fast',
  });
  ```

  **Chromium only.** Firefox / WebKit emit a one-time
  `[vantage] networkPreset is Chromium-only; ignoring for $engine`
  warning to stderr and run at full bandwidth — bandwidth doesn't
  affect a11y / smoke signal strongly enough to justify a skip.

  **Not wired into**: keyboard.spec (focus indicators don't depend on
  bandwidth), emulated-media.spec (media queries don't depend on
  bandwidth), virtual-sr.spec (sync DOM sweep), or lighthouse.spec
  (Lighthouse runs its own simulated throttling for accurate perf
  budgets — having two throttlers fight produces non-deterministic
  scores).

- **Consumer-registered release-only specs (`releaseOnlyPatterns`).**
  v0.2 hardcoded vantage's built-in release-only spec list
  (`nvda`, `lighthouse`, `html-validate`) — non-`chromium__desktop-1280`
  projects ignore those files at the Playwright project level so they
  never spawn a worker just to skip from inside the test body. v0.4
  exposes `cfg.releaseOnlyPatterns?: string[]` so consumers can apply
  the same gating to their own perf / a11y-deep / golden specs.

  ```ts
  releaseOnlyPatterns: ['**/my-perf.spec.js', '**/a11y-deep.spec.js'],
  ```

  **Caveat — testIgnore is matched against files discovered by
  `testDir`.** vantage's `testDir` is its own bundled specs dir, so
  `releaseOnlyPatterns` only fires against specs that ARE discoverable
  there. For consumer specs in a separate root, use the
  `VANTAGE_RELEASE === '1'` env signal in your own
  spec body. `playwrightOverrides.projects` would replace vantage's
  whole engine × viewport matrix, and `playwrightOverrides.testIgnore`
  gets overwritten by the load-bearing visual gate that re-applies
  after the spread — so a behavioural `test.skip()` is the cleanest
  consumer-side gate:

  ```ts
  // my-perf.spec.ts (consumer's spec, anywhere in their tree)
  import { test } from '@playwright/test';
  test.skip(process.env.VANTAGE_RELEASE !== '1', 'release-only');
  ```

- **lychee version skew warning.** `--links` now spawns
  `lychee --version` before the main sweep and warns to stderr if the
  installed lychee is older than 0.13.0 — vantage uses
  `--no-progress` / `--max-concurrency` / `--timeout` and older
  builds may not support all three. Never blocks the run; parse
  failure on the version string emits a softer warning and proceeds.

### v0.3 additions

- **Per-route `lighthouseThresholds` override.** v0.2 shipped a suite-wide
  thresholds object; v0.3 lets a single route relax (or tighten) its own
  budget without affecting the rest of the site. Layering, top-down:
  defaults → suite-wide `cfg.lighthouseThresholds` → per-route
  `route.lighthouseThresholds`. Each layer overrides the previous one
  per-category, so a route that specifies only `{ performance: 60 }`
  still inherits the other three thresholds from the suite-wide layer.

  ```ts
  routes: [
    { name: 'home', path: '/' },
    {
      name: 'dashboard',
      path: '/dashboard',
      // Dashboard pulls 4 MB of charting JS — relax perf to a realistic
      // floor for this route while keeping the rest of the site at the
      // suite-wide default.
      lighthouseThresholds: { performance: 50 },
    },
  ],
  ```

- **Authenticated routes via `cfg.auth`.** Set `cfg.auth.setup` to a path
  pointing at a JS/TS module that returns a Playwright `storageState`
  object (cookies + localStorage). vantage imports it, calls its
  default export, persists the result to
  `.vantage/auth/storageState.json` (override via
  `cfg.auth.storageStatePath`), and wires the cached state into every
  Playwright project's `use.storageState`. The setup module is invoked
  ONCE per run unless the cached file is older than
  `cfg.auth.expirySeconds`.

  ```ts
  // vantage.config.ts
  export default defineConfig({
    baseURL: 'http://127.0.0.1:3000',
    routes: [{ name: 'dashboard', path: '/dashboard' }],
    webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3000' },
    auth: {
      setup: './vantage.auth.ts',
      teardown: './vantage.auth.teardown.ts',  // optional
      storageStatePath: '.vantage/auth/storageState.json',  // default
      expirySeconds: 3600,  // re-run setup after one hour
    },
  });
  ```

  ```ts
  // vantage.auth.ts — consumer-authored
  import { chromium } from '@playwright/test';
  export default async function setupAuth() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:3000/login');
    await page.fill('#email', process.env.TEST_USER!);
    await page.fill('#password', process.env.TEST_PASS!);
    await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard');
    const state = await page.context().storageState();
    await browser.close();
    return state;
  }
  ```

  Run `npx vantage teardown` to invoke `cfg.auth.teardown` (if set) and
  delete the cached state — useful after a test run leaves session
  cookies behind. `--no-auth` bypasses the setup for one run (useful for
  smoke-testing your unauthenticated landing route).

- **Visual regression baselines drift across Windows minor updates.** ClearType
  subpixel font hinting is recomputed when Windows updates the system font cache,
  which lands silently — a baseline captured on Windows 11 build 22631 will mismatch
  on 22635 even though no application code changed. vantage ships NO baselines and
  ships no opinion on where you store them, but it surfaces two Playwright escape
  hatches you should pick BEFORE running `--visual --update-snapshots` the first time:

  ```ts
  // vantage.config.ts — full file. The `osBuild` const above the
  // defineConfig() call is load-bearing: snapshotPathTemplate
  // interpolates it at config-evaluation time.
  import { defineConfig } from 'vantage';
  import os from 'node:os';

  // Encode the Windows build number into the snapshot path so each build
  // gets its own baseline tree. `os.release()` on Windows returns
  // "10.0.22631", which keys the snapshots to the kernel version.
  const osBuild = process.platform === 'win32' ? os.release() : process.platform;

  export default defineConfig({
    baseURL: 'http://127.0.0.1:3000',
    routes: [{ name: 'home', path: '/' }],
    webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3000' },

    visualThreshold: 0.01, // tolerate 1% pixel drift per snapshot

    playwrightOverrides: {
      // Each Windows build (and each non-Windows platform) gets its own
      // baseline tree. The `{arg}` token is Playwright's snapshot name.
      snapshotPathTemplate: `__screenshots__/${osBuild}/{arg}{ext}`,
    },
  });
  ```

  Pick the level of tolerance you need: `visualThreshold` (a single 0..1 number
  passed to Playwright's `maxDiffPixelRatio`) is the cheap mass-tolerance knob;
  `snapshotPathTemplate` segregates baselines so a Windows update doesn't break
  every snapshot at once. Use both. Floor for `visualThreshold` is 0.01 — exact
  matching (0.0) WILL flake even between two consecutive runs on the same machine.

- **`--visual` runs ONLY the visual spec.** Other specs are excluded at config
  level, not skipped at runtime. This is intentional: visual regression is a
  separate cadence, not a default add-on, because baselines are a maintenance
  cost the consumer opts into. To capture or update baselines:

  ```sh
  npx vantage --visual --update-snapshots    # capture / overwrite baselines
  npx vantage --visual                       # compare against existing
  ```

  By default the visual spec runs on `chromium__desktop-1280` only. Override via
  `visualProject: 'firefox__tablet-768'` (must match a generated project name).

### v0.2 additions

- **`node node_modules/@guidepup/setup/bin/setup` is the first-run install for NVDA.** It downloads a custom NVDA build (~30 MB) from GitHub, writes `HKCU\Software\Guidepup\Nvda`, modifies `HKCU\Control Panel\Desktop\ForegroundLockTimeout`, and **kills + restarts `explorer.exe`** — your open File Explorer windows will close and the taskbar will blink. It does NOT trigger UAC, an MSI installer, or SmartScreen, but Windows Defender Real-time Protection will scan the download (expect a few seconds of AV CPU). On corporate machines, endpoint policy may quarantine the download silently — check Defender history if setup hangs or completes without registering the key. The downloaded binary lives in `%TEMP%\guidepup_nvda_*`; periodic Storage Sense cleanup can wipe it, leaving a stale registry path. Re-run setup if `vantage --release` complains that NVDA cannot launch.

- **`--release` runs the BUILT artefact, not the dev server.** Lighthouse perf scores against a `next dev` / `vite dev` server are meaningless (dev-mode bundling, HMR overhead, source maps inline). Configure your `webServer.command` to `npm run build && npm run start` (or equivalent) when running `--release`; wallclock will be longer but the budgets will reflect production. Consider a separate `vantage.release.config.ts` if your dev + prod commands diverge significantly — point `vantage --release --config=vantage.release.config.ts` at it.

- **ClearType subpixel font hinting on Windows still moves between minor updates.** v0.2 does NOT yet wire visual regression — that's deferred to v0.3 — but the warning stands for any consumer running their OWN `toHaveScreenshot()` baselines: a Windows Update can shift baselines by 1–2 pixels per glyph and break every snapshot. If you add visual regression today, set Playwright's `_ctx.snapshotPathTemplate` to encode the Windows build number, or accept tolerance via `maxDiffPixelRatio`.

- **Cadence discipline.** The four cadences shipped in v0.2 are deliberate — running `--release` on every push trains people to ignore failures. `--smoke` exists to give the per-push signal latency budget (< 60 s); the default suite belongs on PR open; `--release` belongs on the pre-tag job (so failures gate a publish, not a feature branch); `--links` is nightly because link-rot is a slow problem and lychee against a large site costs minutes. Don't merge them into a single mega-job.

- **`.vantage/last-run/` is the canonical artefact surface for CI consumption.** Wire your CI's "upload-artifact" step at `.vantage/last-run/` — every cadence writes there:
  - `summary.json` — pass/fail counts + config snapshot, machine-readable. This is what a CI dashboard should read.
  - `disabled-axe-rules.md` — loud list of every axe rule the consumer suppressed, with their justification. **This is the canonical "what got disabled and why" artefact, NOT the HTML report header.** A CI check that fails when this file's contents change is the cheapest way to catch silent rule additions.
  - `html-report/index.html` — Playwright's HTML report (full traces, screenshots, videos on failure).
  - `lychee-output.txt` — present only after `--links`; the raw lychee output for triage.

### v0.1 baseline

- **`storageState` reuse will break tests if you add authenticated routes later.** vantage ships clean-by-default config; if you add auth via a `globalSetup`, also add a `globalTeardown` that deletes any `storageState.json` before the next run. v0.1 does not ship auth helpers.

- **Gitignore `test-results/`, `playwright-report/`, and `.vantage/` in your consuming project.** Playwright traces are 5–50 MB per failure; they will bloat your repo otherwise. The starter `.gitignore` snippet:

  ```
  node_modules/
  test-results/
  playwright-report/
  .vantage/
  ```

- **ClearType subpixel font hinting on Windows** can drift between minor Windows updates. If you enable visual regression in v0.2, expect baseline flake — set `fontHinting: 'none'` or accept tolerance.

- **`webServer` port conflicts.** vantage launches your dev server via Playwright's webServer config. If a previous run left a dead server bound to the port, pass `--no-reuse` to force a fresh launch.

- **Console-error capture is noisy out of the box.** vantage ships a default ignore-list (analytics beacons blocked by adblockers, framework deprecation warnings, browser-extension chatter). Extend it via `consoleIgnore: [...]` in your config. The consumer list is **concatenated** with the defaults, never replaces them.

- **`networkidle` is unreliable** on modern sites — analytics and websockets keep the network busy forever. vantage uses `domcontentloaded` by default and supports an opt-in `[data-test-ready]` convention. If your app emits this selector when truly ready, set `readyMarker: '[data-test-ready]'` in your config.

- **axe `color-contrast` false positives on backgrounds with `background-image`.** axe cannot sample the actual pixel under the text on top of an image. vantage logs these as warnings at `--smoke` level rather than failing — manual review needed.

- **WebKit locale + timezone differ from your machine defaults.** vantage sets `en-GB` / `Europe/London` by default. Override `locale` and `timezoneId` in config if your audience is elsewhere.

- **Playwright WebKit on Windows + localhost IPv6.** Some Windows 11 configurations do not route WebKit's `localhost` to IPv4. If WebKit tests cannot connect but Chromium/Firefox work, force IPv4: `baseURL: 'http://127.0.0.1:<port>'`.

- **Disabled axe rules are written to `.vantage/last-run/disabled-axe-rules.md` on every run, with the consumer-supplied reason.** vantage refuses to load a config that disables an axe rule without a `reason` string — anti-compliance-theatre by design. Treat that file as a review artefact: a CI check that fails when its contents change is a cheap way to catch silent rule additions.

- **Firefox does not support mobile / touch emulation.** Playwright's Firefox build does not honour `isMobile`, `hasTouch`, or `deviceScaleFactor` on `newContext`. vantage still runs the Firefox engine at every viewport _size_ (so responsive CSS is exercised), but `firefox__mobile-*` projects use a desktop UA and no touch flag. For real mobile-Firefox QA, use a real device.

---

## Future work (no committed cadence)

The maintainer does not have a macOS dev box in the validation loop
and has no plans to add one in the foreseeable future. The items
below are documented for anyone who picks up the repo with the
required hardware; vantage is otherwise at a stable resting state
as of v0.6.

- macOS VoiceOver (Guidepup exposes `voiceOverTest` mirroring `nvdaTest`; the v0.2 `nvda.spec.ts` shape is the template — lazy import behind a `process.platform === 'darwin'` gate + project-level testIgnore + soft assertion on phrase content)
- Cross-worker dedupe of the per-worker `networkPreset` warn-once message (would require IPC; currently fires up to ~10x per run on non-Chromium engines — acceptable noise floor)
- NVDA `spokenPhraseLog()` empty-string fix (needs a host with audibly-running NVDA in the validation loop; currently swallowed via soft assertion)

---

## What vantage does NOT cover

Honest list, not optimistic:

- Real iOS Safari behaviour (only Playwright WebKit, which is engine-close but not behaviour-identical).
- Real network throttling (Chromium CDP only — accurate at the protocol layer, but not a physical-radio simulation; Firefox / WebKit run at full bandwidth).
- Real Android Chrome with real GPU and real touch.
- Embedded webviews (Facebook in-app browser, Twitter card, etc.).
- JavaScript bundle-size budgets.
- Server-side rendering correctness beyond first paint.
- JAWS and VoiceOver (NVDA only — Guidepup supports VoiceOver but vantage has not wired the macOS path yet).

---

## Contributing / versioning

vantage follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). **Pin to a tag** (`#v0.1.0`) rather than floating `main`. Breaking changes happen at minor-version bumps pre-1.0.

Issues and PRs welcome at the repo. Run `npm install` then `npm run prepare` in a checkout to build `dist/`.

---

## License

[MIT](./LICENSE). Copyright © vantage contributors.
