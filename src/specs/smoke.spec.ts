import { test, expect } from '@playwright/test';
import { gotoRoute, applyNetworkPreset, loadVantageConfig, isCi } from './_helpers.js';

const cfg = loadVantageConfig();

test.describe('smoke', () => {
  for (const route of cfg.routes) {
    test(`route ${route.name} (${route.path})`, async ({ page }) => {
      const consoleProblems: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];

      const ignoreList = cfg.consoleIgnore;
      const shouldIgnore = (text: string): boolean =>
        ignoreList.some((rx) => rx.test(text));

      page.on('console', (msg) => {
        const text = msg.text();
        const type = msg.type();
        // --ci escalates warnings to failures; non-ci mode only flags errors.
        const isProblem =
          type === 'error' || (isCi() && type === 'warning');
        if (!isProblem) return;
        if (shouldIgnore(text)) return;
        consoleProblems.push(`[${type}] ${text}`);
      });

      page.on('pageerror', (err) => {
        const text = err.message || String(err);
        if (shouldIgnore(text)) return;
        pageErrors.push(text);
      });

      page.on('requestfailed', (req) => {
        const failure = req.failure();
        const url = req.url();
        // Browsers fire requestfailed for ad-blocker refusals too; honour
        // the consoleIgnore list for the URL as well.
        if (shouldIgnore(url) || (failure && shouldIgnore(failure.errorText))) {
          return;
        }
        failedRequests.push(`${req.method()} ${url} :: ${failure?.errorText ?? 'unknown'}`);
      });

      await applyNetworkPreset(page, cfg);

      await gotoRoute(page, route);

      if (cfg.readyMarker) {
        // Wait for the consumer-defined ready selector. We use a generous
        // timeout because hydration on slow CI runners can take several
        // seconds; the assertion failure surfaces clearly if it never appears.
        await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });
      }

      // Settle a beat so async console errors from late-hydrating scripts
      // have a chance to surface before assertions.
      await page.waitForTimeout(250);

      expect(pageErrors, `uncaught page errors on ${route.path}`).toEqual([]);
      expect(consoleProblems, `console problems on ${route.path}`).toEqual([]);
      expect(failedRequests, `failed network requests on ${route.path}`).toEqual([]);
    });
  }
});
