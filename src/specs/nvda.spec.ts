import { test as plainTest } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gotoRoute, loadVantageConfig } from './_helpers.js';

const cfg = loadVantageConfig();
const isRelease = process.env.VANTAGE_RELEASE === '1';
const isWindows = process.platform === 'win32';

/**
 * Real NVDA smoke (Windows-only, --release-only).
 *
 * Why a single test that loops over routes instead of one test per route:
 *   NVDA is a foreground-app screen reader. Two NVDA processes cannot
 *   coexist on the same Windows session, and the Playwright/Guidepup
 *   fixture is per-test — so multiple `nvdaTest()` blocks would attempt
 *   to start a fresh NVDA per test and race each other on the kernel
 *   keyboard hooks. One long-lived session per file is the only safe
 *   shape. If you need broader NVDA coverage, add additional .spec
 *   files; do not split this one into multiple tests.
 *
 * Why a single project (chromium + first viewport) instead of the full
 * engine x viewport matrix:
 *   The whole matrix would try to run NVDA in parallel against three
 *   engines and five viewports — same kernel-hook race. We pin to
 *   chromium because Guidepup's NVDA bindings are stable there;
 *   firefox/webkit are not validated upstream. We also set
 *   `workers: 1` for the release cadence in playwright.config so the
 *   non-supported projects' workers don't run in parallel either.
 *
 * Why `@guidepup/playwright` is imported lazily inside the
 * isRelease+isWindows branch (not at module top):
 *   The import was previously unconditional, which means a non-release
 *   run on Linux (where guidepup may grow a Windows-only native dep
 *   in any future version) would crash the spec file at load time.
 *   Lazy import keeps the failure mode clean: the spec skips, the run
 *   continues.
 */

const SUPPORTED_PROJECT = 'chromium__desktop-1280';

if (!isRelease) {
  // We still need a test entry so Playwright doesn't error "no tests
  // discovered". A skipped placeholder makes the gating visible in
  // the report.
  plainTest.describe('nvda (real screen reader)', () => {
    plainTest.skip(true, '--release not set; skipping NVDA spec.');
    plainTest('release-gated', () => {});
  });
} else if (!isWindows) {
  plainTest.describe('nvda (real screen reader)', () => {
    plainTest.skip(true, `NVDA is Windows-only; current platform: ${process.platform}.`);
    plainTest('windows-only', () => {});
  });
} else {
  // Top-level await is allowed here because the package is ESM
  // (package.json#type === 'module'). The import sits behind the
  // isRelease + isWindows gate so non-Windows release runs never
  // touch @guidepup/playwright.
  const { nvdaTest } = await import('@guidepup/playwright');

  nvdaTest.describe.configure({ mode: 'serial', retries: 0 });

  nvdaTest.describe('nvda (real screen reader)', () => {
    nvdaTest(
      `accessible-name announcements across ${cfg.routes.length} route(s)`,
      async ({ page, nvda }, testInfo) => {
        // Skip non-supported projects from inside the test body —
        // `test.skip(callback)` does not receive `testInfo`, so we
        // can't gate at describe-level. (The release cadence also
        // sets `workers: 1` in playwright.config so the skipped
        // projects don't start their NVDA fixture in parallel.)
        nvdaTest.skip(
          testInfo.project.name !== SUPPORTED_PROJECT,
          `NVDA spec only runs on project "${SUPPORTED_PROJECT}" to avoid parallel-session races.`
        );

        // Generous wallclock: NVDA startup is ~5s, each navigation +
        // settle is ~2s, plus announcement capture. Tune via the
        // consumer's playwrightOverrides.timeout if needed.
        testInfo.setTimeout(120_000);

        const allAnnouncements: { route: string; phrases: string[] }[] = [];

        for (const route of cfg.routes) {
          await gotoRoute(page, route);
          if (cfg.readyMarker) {
            await page.waitForSelector(cfg.readyMarker, {
              state: 'attached',
              timeout: 30_000,
            });
          }

          // Reset NVDA's announcement log before walking this route so
          // we can attribute output cleanly.
          await nvda.navigateToWebContent();

          // Walk forward through the first ~25 stops. Each await on
          // `nvda.next()` resolves when the keystroke has been sent,
          // not necessarily when NVDA has finished synthesising the
          // announcement — so phrase capture depends on the consumer's
          // speech-synth driver. That is precisely why we treat the
          // captured log as a SOFT artefact rather than the assertion.
          for (let i = 0; i < 25; i++) {
            await nvda.next();
          }

          const log = await nvda.spokenPhraseLog();
          allAnnouncements.push({ route: route.name, phrases: log });
        }

        // The smoke value here is "NVDA started, attached, and walked
        // every route without throwing" — that signal is captured by
        // the test body completing. We INTENTIONALLY do not assert on
        // phrase content or count: depending on the Guidepup-NVDA
        // build and the host's speech-synth driver, the captured log
        // may be empty even when NVDA is operating correctly.
        // Asserting on a non-empty log produces false positives in
        // real environments.
        //
        // Instead, persist the captured phrases under
        // `.vantage/last-run/nvda-spoken-phrases.json` so a human
        // reviewer can confirm NVDA's accessibility-tree walk matches
        // expectations on each route.
        const artefactDir = path.join(process.cwd(), '.vantage', 'last-run');
        await mkdir(artefactDir, { recursive: true });
        await writeFile(
          path.join(artefactDir, 'nvda-spoken-phrases.json'),
          JSON.stringify(allAnnouncements, null, 2),
          'utf8'
        );
      }
    );
  });
}
