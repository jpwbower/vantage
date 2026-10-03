import { test, chromium } from '@playwright/test';
import { gotoRoute, loadVantageConfig } from './_helpers.js';
import type { ResolvedVantageConfig } from '../types.js';

const cfg = loadVantageConfig();
const isRelease = process.env.VANTAGE_RELEASE === '1';

/**
 * Lighthouse perf / a11y / best-practices / seo budgets.
 *
 * Why this spec launches its OWN browser instead of using the
 * Playwright `page` fixture:
 *   playwright-lighthouse needs Chromium with `--remote-debugging-port`
 *   open so the Lighthouse runner can connect via CDP. Playwright's
 *   default browser launch does not expose that port. Spawning a
 *   dedicated browser per audit is cheaper than reconfiguring the
 *   shared fixture and keeps the audit hermetic.
 *
 * Why a single project rather than the engine x viewport matrix:
 *   Lighthouse only supports Chromium-family browsers. Running it
 *   across every project would produce identical scores at most
 *   viewports (Lighthouse uses its own emulation) or hard errors on
 *   firefox/webkit. Pin to one project.
 *
 * Why thresholds default to 75/95/85/90 and not 100:
 *   Real-world apps rarely hit 100 on perf without aggressive
 *   optimisation; treating 75 as the floor catches regressions
 *   without breaking the build on day one. Consumers can override
 *   via `lighthouseThresholds` in vantage.config.ts.
 */

const SUPPORTED_PROJECT = 'chromium__desktop-1280';

const defaultThresholds = {
  performance: 75,
  accessibility: 95,
  'best-practices': 85,
  seo: 90,
};

// Suite-wide thresholds: defaults merged with cfg.lighthouseThresholds.
// Per-route thresholds layer ON TOP of this — see thresholdsForRoute().
const suiteThresholds = { ...defaultThresholds, ...(cfg.lighthouseThresholds ?? {}) };

/**
 * Resolve the effective thresholds for a route. Layering, top-down:
 *   1. defaults (perf 75, a11y 95, best-practices 85, seo 90)
 *   2. cfg.lighthouseThresholds (suite-wide)
 *   3. route.lighthouseThresholds (per-route)
 * Later layers override earlier ones per-category, so a route that
 * specifies only `performance: 60` still inherits the other three
 * thresholds from the suite-wide / default layers.
 */
function thresholdsForRoute(
  routeOverrides?: Record<string, number | undefined>
): Record<string, number> {
  if (!routeOverrides) return suiteThresholds;
  return { ...suiteThresholds, ...routeOverrides } as Record<string, number>;
}

/**
 * Allocate a free TCP port for Chromium's --remote-debugging-port.
 *
 * Note: there is a TOCTOU race between `server.close()` and
 * `chromium.launch()` — another process can grab the port in the
 * window between. In practice this is extremely rare (release runs
 * are serialised and Playwright workers don't fight for ports
 * themselves), and the failure mode is loud (Chromium fails to start
 * and the test errors immediately). If you hit it repeatedly,
 * reserve a fixed port via VANTAGE_LIGHTHOUSE_PORT.
 */
async function findFreePort(): Promise<number> {
  const fixed = process.env.VANTAGE_LIGHTHOUSE_PORT;
  if (fixed) {
    const n = Number(fixed);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new Error(`VANTAGE_LIGHTHOUSE_PORT="${fixed}" is not a valid port number.`);
    }
    return n;
  }
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('failed to allocate free port'));
      }
    });
  });
}

if (!isRelease) {
  test.describe('lighthouse', () => {
    test.skip(true, '--release not set; skipping Lighthouse spec.');
    test('release-gated', () => {});
  });
} else {
  test.describe.configure({ mode: 'serial', retries: 0 });

  test.describe('lighthouse', () => {
    for (const route of cfg.routes) {
      test(`budgets on ${route.name} (${route.path})`, async ({}, testInfo) => {
        test.skip(
          testInfo.project.name !== SUPPORTED_PROJECT,
          `Lighthouse spec only runs on project "${SUPPORTED_PROJECT}" (Chromium-only).`
        );
        testInfo.setTimeout(180_000);

        let playAudit: typeof import('playwright-lighthouse').playAudit | undefined;
        try {
          const mod = await import('playwright-lighthouse');
          playAudit = mod.playAudit;
        } catch (err) {
          test.skip(
            true,
            `playwright-lighthouse is not installed: ${
              err instanceof Error ? err.message : String(err)
            }. Run \`npm i -D playwright-lighthouse lighthouse\` in your project.`
          );
          return;
        }

        const port = await findFreePort();
        const browser = await chromium.launch({
          args: [`--remote-debugging-port=${port}`],
        });
        try {
          // The Lighthouse spec launches its own browser (CDP requirement)
          // rather than using Playwright's fixture-managed context, so
          // Playwright's project-level `use.storageState` does NOT apply
          // here. If cfg.auth produced a cached storageState, we must
          // pass it explicitly — otherwise an authenticated route would
          // redirect to /login and Lighthouse would score the login page.
          const storageStatePath = (cfg as ResolvedVantageConfig & {
            storageStatePath?: string;
          }).storageStatePath;
          const page = await browser.newPage({
            baseURL: cfg.baseURL,
            locale: cfg.locale,
            timezoneId: cfg.timezoneId,
            ...(storageStatePath ? { storageState: storageStatePath } : {}),
          });
          await gotoRoute(page, route);
          if (cfg.readyMarker) {
            await page.waitForSelector(cfg.readyMarker, {
              state: 'attached',
              timeout: 30_000,
            });
          }

          await playAudit!({
            page,
            port,
            thresholds: thresholdsForRoute(route.lighthouseThresholds as Record<string, number | undefined> | undefined),
            // Suppress chalk-coloured noise in Playwright's reporter output
            // — failures are still surfaced via the playAudit throw.
            disableLogs: true,
          });
        } finally {
          await browser.close();
        }
      });
    }
  });
}
