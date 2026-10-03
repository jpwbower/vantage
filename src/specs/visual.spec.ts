import { test, expect } from '@playwright/test';
import { gotoRoute, loadVantageConfig } from './_helpers.js';

const cfg = loadVantageConfig();
const isVisual = process.env.VANTAGE_VISUAL === '1';

/**
 * Visual regression via Playwright's `toHaveScreenshot()`.
 *
 * Gated on the `--visual` flag (top-level testMatch in playwright.config.ts
 * routes only this spec when the flag is set, and excludes it otherwise),
 * not on `--release`. Why separate cadence: baselines are consumer-managed
 * artefacts that live in the consumer's repo, not vantage's — and the
 * Windows ClearType subpixel-hinting flake means baselines drift across
 * minor Windows updates regardless of code changes. See README for the
 * `snapshotPathTemplate` escape hatch.
 *
 * Why a single project rather than the engine x viewport matrix: 15
 * projects worth of baselines balloons review-time + storage without
 * proportional signal. Pick one stable engine/viewport (default
 * `chromium__desktop-1280`) and run visual there. Configure
 * `visualProject` if you need a different one.
 *
 * vantage ships NO baselines. First-time consumers run
 * `npx vantage --visual --update-snapshots` to capture, then check the
 * resulting `__screenshots__/` directory in.
 */

const SUPPORTED_PROJECT = cfg.visualProject ?? 'chromium__desktop-1280';
const THRESHOLD = cfg.visualThreshold ?? 0.01;

if (!isVisual) {
  test.describe('visual', () => {
    test.skip(true, '--visual not set; skipping visual regression spec.');
    test('visual-gated', () => {});
  });
} else {
  test.describe('visual', () => {
    for (const route of cfg.routes) {
      test(`screenshot ${route.name} (${route.path})`, async ({ page }, testInfo) => {
        test.skip(
          testInfo.project.name !== SUPPORTED_PROJECT,
          `Visual spec only runs on project "${SUPPORTED_PROJECT}". ` +
            `Set cfg.visualProject to change which engine__viewport project visual regression runs on.`
        );
        await gotoRoute(page, route);
        if (cfg.readyMarker) {
          await page.waitForSelector(cfg.readyMarker, {
            state: 'attached',
            timeout: 30_000,
          });
        }
        // Snapshot name keys on route.name (not testInfo.title) so renaming
        // a test title doesn't orphan the baseline. fullPage captures the
        // whole route, not just the viewport.
        await expect(page).toHaveScreenshot(`${route.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: THRESHOLD,
        });
      });
    }
  });
}
