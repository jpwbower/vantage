<!-- vantage-build-tracker schema v1 -->
# vantage — build tracker

This file is the cross-thread handoff mechanism. Every chunk reads it on
entry to discover its work; every chunk updates it on close. Do not
delete prior chunk rows — append to "Chunks complete".

## Current state

- Version shipped: v0.6.1 (patch on top of v0.6.0)
- Tag pushed: yes
- Branch: main
- HEAD SHA at last close: see `git rev-parse v0.6.1^{commit}` (tag-pointer convention from Chunk 5 onward — no SHA embedded in this file, no amend needed.)
- Node version exercised: 24.14.0 (Node 22 LTS is the pinned floor; operator dev box on 24)
- npm version exercised: 11.9.0
- Playwright version exercised: 1.60.0 (peerDep `>=1.50.0`, open lower bound)
- Lighthouse version exercised: 13.3.0 (via playwright-lighthouse 4.0.0)
- Guidepup versions exercised: @guidepup/guidepup 0.24.1, @guidepup/playwright 0.15.0, @guidepup/setup 0.21.0
- html-validate version exercised: 11.4.0
- lychee version exercised: 0.24.2 (binary install from GitHub release; `.cmd` shim path exercised via a synthetic `lychee.cmd` shim on PowerShell — happy path and retry both validated)
- http-server version exercised (visual fixture + CI smoke fixture): 14.1.1
- Guidepup setup script: re-run during Chunk 6 validation? NO — already registered from Chunk 2.
- Stable resting state: as of v0.6.0, vantage is feature-complete for the operator's roadmap. CI gates regressions on the published tarball; no further chunks planned. The remaining items in "Future work" require either a Mac dev box (VoiceOver) or a host with audibly-running NVDA (spokenPhraseLog), neither of which is in the operator's foreseeable validation loop.

## Chunks remaining

None planned. vantage is at a stable resting state as of v0.6.0.
Items previously queued for v0.6+ have moved to "Future work
(unbacked by hardware)" below — they remain documented for anyone
who picks up the repo with the missing hardware, but are not on a
staged-chunk cadence and do not gate any future release.

## Future work (unbacked by hardware)

- **macOS VoiceOver.** Guidepup exposes `voiceOverTest` mirroring
  `nvdaTest`. The v0.2 `nvda.spec.ts` shape is the template — lazy
  import behind a `process.platform === 'darwin'` gate, project-level
  testIgnore via the same `RELEASE_ONLY_SPECS` mechanism, soft
  assertion on `spokenPhraseLog()` content. Requires a macOS dev box
  with VoiceOver visible; the operator does not have one and has no
  plans to add one.
- **Cross-worker dedupe of the `networkPreset` warn-once message.**
  Module-level `Set<string>` in `src/specs/_helpers.ts` dedupes
  within a single Playwright worker, but workers don't share state —
  so a non-chromium config emits up to ~10 warnings under `--full`.
  Cross-worker dedupe would require IPC (filesystem-based lock, or
  Playwright's `globalSetup` writing a sentinel). Acceptable noise
  floor in practice; low-priority polish.
- **NVDA `spokenPhraseLog()` empty-string on the operator's dev
  box.** Guidepup wires NVDA → captures spoken phrases, but the
  returned log is empty on this dev box. Could be a config or
  audio-subsystem issue; needs a host with audibly-running NVDA to
  diagnose. Currently swallowed via soft assertion (the spec passes
  even when the log is empty), so the regression surface is "we
  can't catch announcement-content bugs", not "the spec fails".

## Chunks complete

| Chunk | Version | Scope | Commit range | HEAD SHA | Tag |
| ----- | ------- | ----- | ------------ | -------- | --- |
| Child-bound readiness | Unreleased | Runner-owned fresh webServer for --no-reuse / --ci; foreign-port refusal, stdio port gate, browser-free S1/S2/S3 scenarios; default reuse and gate paths preserved. | dfbd6bd..this commit | see this row's introducing commit | — |
| 1 | v0.1.0 | Scaffold: package, types, defineConfig, Playwright matrix, smoke / a11y / keyboard / emulated-media / virtual-sr specs, CLI entry, init template, full README, R5 remediation of Opus review findings | root..v0.1.0 | e61f49e (+ tag commit) | v0.1.0 |
| 2 | v0.2.0 | --release cadence (nvda, lighthouse, html-validate); --links cadence (lychee shellout); vantage init --ci (GHA workflow template); lighthouseThresholds config field; unified summary.json schema across cadences with `cadence` discriminator; project-level testIgnore for release-only specs + workers:1 on release for NVDA foreground-app safety; R5 remediation (version bump, lychee streaming, NVDA lazy import, GHA template lychee-action@v2, defensive guidepup-setup check) | v0.1.0..v0.2.0 | ea0d438 (+ tag commit) | v0.2.0 |
| 3 | v0.3.0 | --visual cadence (Playwright `toHaveScreenshot()` on one project, gated flag-driven via top-level testMatch flip; cfg.visualProject + cfg.visualThreshold); cfg.auth lifecycle (setup module producing storageState, cache + expiry, --no-auth bypass, `vantage teardown` subcommand); per-route lighthouseThresholds override; webServer.cwd default-bug fix (was defaulting to vantage/dist, now resolves to consumer project root in the runner); R5 remediation (lighthouse storageState honour, --visual playwrightOverrides clobber-proofing, --visual flag-conflict rejection, route-name uniqueness, atomic storageState write, named-export error UX, JSON.stringify wrap, parseArgs engine/reporter validation) | v0.2.0..v0.3.0 | b1f3336 (tag points AT this commit) | v0.3.0 |
| 4 | v0.4.0 | `cfg.networkPreset` (Chromium-CDP throttling via Playwright newCDPSession, wired into smoke.spec + a11y.spec only; firefox/webkit emit per-worker one-time stderr warning; lighthouse.spec explicitly NOT wired since Lighthouse runs its own simulated throttling); `cfg.releaseOnlyPatterns` (Shape B per design decision — appended to BUILT_IN_RELEASE_ONLY_SPECS in playwright.config.ts for project-level testIgnore on non-RELEASE_SUPPORTED_PROJECT projects; testIgnore matches against files discoverable under vantage's testDir, separate-root consumer specs gate themselves via test.skip() keyed on `process.env.VANTAGE_RELEASE`); lychee min-version pre-flight (`spawn('lychee', ['--version'])` round-trip, captures stdout AND stderr, parses `lychee X.Y.Z`, warns to stderr if < 0.13.0, parse-failure → softer warning, never blocks); R5 remediation (lychee version-check moved above verbose launch log, stderr capture, README playwrightOverrides example rewritten to test.skip() pattern since the projects/testIgnore override paths both have unintended effects, one-line comment confirming unconditional testIgnore extension) | v0.3.0..v0.4.0 | 745d6de (close commit; tag-commit SHA via `git rev-parse v0.4.0` differs by one amend step — see Current state for why) | v0.4.0 |
| 5 | v0.5.0 | `cfg.htmlValidateRaw` flag (default false): when true, html-validate.spec emits TWO independent test cases per route — post-hydration via `page.content()` and a raw-response pass via Node `fetch(baseURL + route.path)`. Raw fetch deliberately does NOT forward `cfg.auth` storageState cookies (surfacing-by-design: authenticated routes yield their unauthenticated SSR markup, which is the signal). Title-shape side effect: post-hydration title gains `(post-hydration)` suffix only when raw is on, so v0.4 `markup on $name ($path)` shape preserved when flag is off. Default `snapshotPathTemplate` set on top-level config field BEFORE the `playwrightOverrides` spread (later-key-wins lets consumer override of the same top-level key replace it cleanly); default value `path.join(process.cwd(), '__vantage_screenshots__', '{arg}{ext}')` lands baselines inside the consumer's project root (process.cwd() resolves to consumerCwd because runner spawns Playwright with cwd:consumerCwd). lychee `.cmd`-shim fallback on Windows: hybrid of Chunk 5 prompt shapes (a) + (b) — primary `spawn('lychee', args)` stays shell-free (clean .exe path), Windows ENOENT retry uses `shell: true` so cmd.exe resolves PATHEXT to `.cmd`. Modern Node (post CVE-2024-27980) refuses to spawn .cmd files without shell, so pure shape-(a) was infeasible; shell:true trips DEP0190 but vantage prints a single breadcrumb annotating the fallback before the warning fires. Same retry pattern applied to `checkLycheeVersion` probe. R5 remediation (raw-response fetch failure throws Error instead of misleading expect().toBe assertion shape; DEP0190 breadcrumb deduped across version-probe and main-spawn retry sites; tightened snapshotPathTemplate comment on override-semantics edge cases; documented title-shape side effect of htmlValidateRaw in JSDoc) | v0.4.0..v0.5.0 | see `git rev-parse v0.5.0^{commit}` (tag-pointer convention; no embedded SHA, no amend dance) | v0.5.0 |
| 6 | v0.6.0 | Repo-internal release-quality work (no consumer-facing API change). New `.github/workflows/ci.yml` gates `main` + PRs: TypeScript builds, tarball packs, installs into a fresh scratch dir with `type: module` (load-bearing — vantage is ESM-only and `npm init -y` defaults to commonjs, which would fail to resolve the `from 'vantage'` import via tsx with `No "exports" main defined`), Chromium installs (cached per OS + tarball name), `npx vantage --smoke --ci` runs against the new `ci/fixture/index.html`. Matrix: ubuntu-latest + windows-latest for smoke; macos-latest runs build-only (compile-clean signal; no smoke without a Mac dev box). No --release / --links / --visual in CI (NVDA / Lighthouse / lychee / baselines all need bespoke setup that isn't worth the per-push budget). VoiceOver / cross-worker networkPreset dedupe / NVDA spokenPhraseLog moved from "deferred chunks" to "future work (unbacked by hardware)"; vantage reaches stable resting state. | v0.5.0..v0.6.0 | see `git rev-parse v0.6.0^{commit}` (tag-pointer convention) | v0.6.0 |
| 6-patch-1 | v0.6.1 | Bug-fix patch. Default cadence (`npx vantage`, 3 engines × 5 viewports) could hang indefinitely after the last test reported, because (a) the parent awaited the Playwright child with no upper bound and (b) the generated Playwright config never set `globalTimeout`. When Playwright's worker-pool shutdown deadlocked on multi-engine WebKit-on-Windows runs (`WorkerHost` emits "worker process did not exit within 300000ms after stop" then continues to await the rest of the pool), vantage inherited the deadlock and emitted none of the documented 0/1/2/3/4 exit codes. Fix is belt + braces: (1) cadence-aware `globalTimeout` (5 / 30 / 30 / 60 min for smoke / default / visual / release) forwarded via `VANTAGE_GLOBAL_TIMEOUT_MS` env into the generated Playwright config — Playwright shuts down cleanly + flushes JSON + finalises HTML report on a healthy timeout fire (exit code 1); (2) parent-side SIGTERM → 10 s grace → SIGKILL → 5 s grace escalation in `runPlaywright()`, returning exit code 4 with `hangDetected: true` + a `hang` block on `summary.json` for the deadlock case. ~90 s grace between cadence cap and parent SIGKILL is load-bearing. New `runnerTimeoutMs?: number` public field on `VantageConfig` for consumer override; validated as positive finite number; cadence default applied when unset. Reviewer-runnable `scripts/simulate-hung-child.mjs` (Windows ~2 s / POSIX ~12 s) exercises the SIGKILL path against a sleep-forever child. Independent reviewer pass (fresh-context Opus) returned GO; all 12 findings informational. CHANGELOG link-ref section backfilled [0.4.0]–[0.6.0] alongside the new [0.6.1] (was incomplete on main from earlier chunks). | v0.6.0..v0.6.1 | a33566d (see `git rev-parse v0.6.1^{commit}` to verify) | v0.6.1 |

## Operator-decide carry-forwards

- None at end of Chunk 6. vantage reaches stable resting state.
- macOS VoiceOver: PERMANENTLY DEFERRED. Operator does not have a Mac
  dev box in the validation loop and has no plans to add one in the
  foreseeable future. Moved out of `Chunks remaining` into the
  "Future work (unbacked by hardware)" block; do NOT re-ask this
  question in future threads unless the operator opens one to revisit.

## Known issues / deferred fixes

Carried forward from Chunk 1 (still applicable):

- **Validation against `https://example.com` is thin.** example.com has no
  forms, no SPA routing, and a minimal heading hierarchy. Chunks 1+2+3
  validation proves "the framework launches end-to-end and emits the
  expected artefacts under `.vantage/last-run/`", NOT "the specs
  catch real bugs on real sites". A consumer running vantage against
  their own dev server is the first time the specs are stressed
  against a non-trivial DOM. Chunk 3 added a local static fixture
  (`scratch-fixture/index.html` served via http-server) for the
  `--visual` validation only — example.com cannot be a deterministic
  baseline target.
- **`npx playwright install` size + network.** ~650 MB download from
  Playwright's CDN. Cold install on Windows with Defender Real-time
  Protection enabled is slow. Documented in README.
- **Symlink creation in `.vantage/last-run/`.** Non-elevated Windows
  without Developer Mode cannot symlink — vantage falls back to a
  tiny HTML redirect so the path still resolves.
- **The viewport projects multiply quickly.** 3 engines × 5 viewports
  × N specs × M routes. `--smoke` exists for this reason.
- **`a11y` color-contrast soft-fail logic is heuristic.** Treats
  `bgColor: null` from axe's payload as "background is an image".
- **Firefox does not support mobile / touch emulation.** vantage
  strips `isMobile`, `hasTouch`, `deviceScaleFactor` for Firefox
  projects; viewport size still varies.
- **virtual-sr is structural, not behavioural.** In-page
  accessible-name sweep, not a real screen reader (NVDA covers that
  on --release; VoiceOver still pending v0.5+).

Carried forward from Chunk 2 (still applicable):

- **`--release` is single-threaded under `workers: 1`** because NVDA
  owns the foreground app. v0.3 changes nothing here.
- **Lighthouse defaults assume ship-gate.** v0.3 added per-route
  thresholds (`VantageRoute.lighthouseThresholds`) so consumers can
  relax a single dashboard route without dropping the suite-wide
  floor. The defaults themselves (perf 75, a11y 95, best-practices 85,
  seo 90) remain unchanged.
- **NVDA `spokenPhraseLog()` returns empty strings on the operator's
  dev box.** Soft-assertion shape unchanged in v0.3.
- **Guidepup's NVDA build lives in `%TEMP%`.** Storage Sense can wipe
  it. Re-run `node node_modules/@guidepup/setup/bin/setup` to recover.
- **lychee version skew is silent.** RESOLVED in v0.4 — pre-flight
  `lychee --version` round-trip warns to stderr if installed version is
  older than 0.13.0 (parse failure → softer warning; never blocks).
- **html-validate runs against `page.content()` (post-hydration DOM)
  only.** RESOLVED in v0.5 via `cfg.htmlValidateRaw` — opt-in flag emits
  a second raw-response test case per route, fetched via Node `fetch`.
- **Reviewer-flagged free-port TOCTOU race in lighthouse.spec.ts.**
  Tiny window, release runs serial under workers:1; fix-pin via
  `VANTAGE_LIGHTHOUSE_PORT`. Unchanged in v0.3.

New in Chunk 3:

- **Visual baselines default to
  `node_modules/vantage/dist/specs/visual.spec.js-snapshots/`.**
  RESOLVED in v0.5 — vantage now sets the top-level
  `snapshotPathTemplate` config field to
  `${consumerCwd}/__vantage_screenshots__/{arg}{ext}` before the
  `playwrightOverrides` spread, so baselines land inside the
  consumer's project by default. Consumer top-level
  `playwrightOverrides.snapshotPathTemplate` still wins via later-key
  spread semantics; sibling overrides (e.g. `expect.toHaveScreenshot.pathTemplate`)
  leave the default in place.
- **The `--release` Lighthouse spec honours `cfg.auth.storageState`
  but the underlying chromium.launch() call still uses a fresh
  user-data-dir.** Caches / IndexedDB / other persistent state from
  the storageState file are loaded via `storageState` (cookies +
  localStorage), but anything stored outside of those two channels is
  not portable. For most auth flows this is fine.
- **`auth.setup` runs in the parent runner process** before Playwright
  spawns. If the setup module imports heavy dependencies (e.g. a full
  app server for a synthetic login flow), vantage startup latency
  grows. The cache-with-expiry pattern is the intended mitigation —
  set `expirySeconds` generously for long-lived sessions.
- **`auth.storageStatePath` and `auth.setup` are not path-sandboxed.**
  Consumer-authored config can read/write outside the project root.
  Documented; the config is the consumer's own code.
- **`vantage teardown` deletes the cached storageState even when
  `cfg.auth.teardown` is unset.** This matches the brief's "safety
  net" intent — running `teardown` always invalidates the cache. If a
  consumer wants to inspect the cache before deletion, they can read
  it from `.vantage/auth/storageState.json` directly.
- **`--visual` runs sequentially on one project** by design (one
  engine × one viewport × N routes). Wallclock is shorter than full
  default suite but the consumer is responsible for re-running it on
  every relevant change rather than every push.
- **`--update-snapshots` was a v0.1 passthrough flag with no
  snapshot-producing specs to operate on.** v0.3 made `visual.spec.ts`
  the first consumer; running `--update-snapshots` against any other
  cadence is now a no-op (there are still no other snapshots to
  update), but the flag is documented as a Playwright passthrough so
  this is consistent.

New in Chunk 4:

- **`networkPreset` "warn once" is per-worker, not global.** The
  module-level `Set<string>` in `src/specs/_helpers.ts` deduplicates
  within a Playwright worker process, but workers don't share state.
  In the default `--full` cadence with ~10 workers, a non-chromium
  config will emit up to ~10 `vantage: networkPreset is Chromium-only;
  ignoring for $engine` warnings (one per worker that touches a
  firefox / webkit project). Acceptable noise floor; cross-worker dedupe
  would require IPC.
- **`networkPreset` does NOT affect `lighthouse.spec`.** Lighthouse
  runs its own simulated throttling; having two throttlers fight
  produces non-deterministic scores. Consumer-facing surface: `--release`
  perf gates are orthogonal to `networkPreset`. Documented in README
  v0.4 additions section.
- **CDP `Network.emulateNetworkConditions` is applied per-page in the
  smoke / a11y specs.** The CDP session is never explicitly detached;
  Playwright disposes it on context close. No leak, but if a consumer
  wires the helper into a custom multi-page workflow they should
  expect a fresh CDP session per `page`.
- **`releaseOnlyPatterns` only fires for files discoverable under
  vantage's testDir.** Playwright's `testIgnore` matches against
  files in the active testDir, which is vantage's bundled `specs/`
  dir. Consumer specs in a separate root require a behavioural
  `test.skip(process.env.VANTAGE_RELEASE !== '1', ...)` inside the
  spec body. README v0.4 additions has the worked snippet; Shape A
  (vantage extending testDir to include the consumer's tree) was
  considered and rejected as overreach for v0.4.
- **lychee version probe captures stdout AND stderr.** Some pre-0.10
  lychee builds wrote `--version` to stderr. Probe is best-effort:
  ENOENT silently swallowed (main spawn handles missing-binary), parse
  failure → softer "could not parse" warning, too-old version → loud
  warning. NEVER blocks the run.
- **lychee `.cmd` shim not found on Windows.** RESOLVED in v0.5 —
  hybrid retry: primary `spawn('lychee', args)` stays shell-free for
  the .exe path; Windows ENOENT retry uses `shell: true` so cmd.exe
  resolves PATHEXT to `.cmd`. Modern Node (post CVE-2024-27980)
  refuses to spawn .cmd files without shell, so pure shape-(a) was
  infeasible. Same retry applied to `checkLycheeVersion` probe.

New in Chunk 5:

- **Lychee `.cmd`-shim retry trips Node's DEP0190 deprecation
  warning.** `shell: true` is required to launch `.cmd` files on
  modern Node, but Node emits "Passing args to a child process with
  shell option true can lead to security vulnerabilities, as the
  arguments are not escaped, only concatenated" on stderr each time.
  vantage prints a single `[vantage] lychee: ... DEP0190 is
  expected ...` breadcrumb to stderr at most once per run, before the
  first shell:true invocation, so consumers don't read the
  deprecation as a vantage bug. The .exe primary path (default for
  cargo / brew installs) does not trip the warning. Documented in
  README v0.5 additions.
- **Lychee `.cmd`-shim retry has a non-zero shell-injection surface.**
  `shell: true` passes args concatenated, not escaped. vantage's
  args are `--config <path>`, flag literals, and URLs derived from
  `baseURL + route.path`. defineConfig validates baseURL as a URL and
  route.path to start with `/`, but neither rejects cmd-metacharacters
  (`&`, `|`, `^`, etc.). Threat model: "consumer attacks their own
  machine via their own config" — acceptable for the .cmd retry path
  only. Consumers wanting zero shell surface should install lychee via
  `cargo install lychee` (places `.exe` on PATH) so the retry never
  fires.
- **htmlValidateRaw raw fetch does not honour `cfg.auth.storageState`.**
  By design (surfacing-by-design): cookies live in the browser context
  not Node `fetch`, so the raw response for an authenticated route is
  the unauthenticated SSR markup. That IS the signal — post-hydration
  pass cannot see what SSR serves before the redirect to login. Do not
  add cookie forwarding; it would defeat the value.
- **htmlValidateRaw post-hydration test title shape changes when
  enabled.** v0.4 title `markup on $name ($path)` becomes
  `markup on $name ($path) (post-hydration)` (and a sibling
  `(raw response)`) when the flag is on. CI dashboards keyed on the
  v0.4 full title break; switch to a prefix match on the v0.4 shape.
  Documented in the field's JSDoc.
- **Default `snapshotPathTemplate` only wins for top-level overrides.**
  Consumer's `playwrightOverrides.snapshotPathTemplate` (top-level
  scalar) replaces the default via later-key-wins spread. Sibling
  overrides under `expect.toHaveScreenshot.pathTemplate` leave the
  default in place — both apply (Playwright merges expect-level
  templates over the top-level one per assertion). Comment in
  `playwright.config.ts` spells out both cases.

## Notes for a future maintainer

vantage is at a stable resting state after v0.6.0. No chunks are
queued. If a future maintainer (or the original operator with new
hardware) wants to extend the package, the constraints below apply
the same way they did across Chunks 1-6:

1. **Purity discipline.** vantage is a standalone public OSS
   package. Every commit, every tracked file, every commit author/
   email must be generic. Two grep tests gate this — one against
   `git ls-files` (tracked-file contents), one against `git log`
   author + email + body (full history). The blocklist itself is
   intentionally NOT embedded here (it would self-trigger); the
   canonical list lives in the original chunk-prompt template the
   operator authored. The pattern: no internal project names, no
   personal handles, no personal emails, no operational paths.
   Both greps must return empty at chunk close.

2. **Git identity.** `vantage contributors <noreply@example.com>`
   is set in `.git/config`. Verify before any future commit.

3. **README pinning convention.** The README uses
   `<your-org>/vantage#vX.Y.Z` as a placeholder; the actual repo
   URL lives only in `.git/config` (untracked). Do not write the
   real URL into any tracked file.

4. **Items waiting on hardware** (see `Future work` block above):
   - macOS VoiceOver: Mac dev box with VoiceOver visible.
   - NVDA `spokenPhraseLog()` empty-string: host with audibly-running
     NVDA + Guidepup hook visibility.
   - Cross-worker `networkPreset` dedupe: no hardware blocker; pure
     polish via Playwright `globalSetup` + a sentinel file. Skipped
     for lack of motivating signal, not for lack of feasibility.

5. **CI gates main.** v0.6 added `.github/workflows/ci.yml`. Any
   change touching `src/`, `bin/`, or `package.json` will be smoke-
   tested on both Linux and Windows runners before merge.

6. **SHA-recording convention.** Chunks 5 and 6 use the tag-pointer
   convention — `Current state` HEAD SHA reads `see git rev-parse
   v$VERSION^{commit}`. Earlier chunks (1-4) embedded SHAs and one
   chunk (4) had to use `git commit --amend` to backfill, producing
   a known off-by-one. The tag-pointer convention is the maintained
   path forward.
