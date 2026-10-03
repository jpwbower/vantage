import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { Result } from 'axe-core';
import { gotoRoute, loadVantageConfig } from './_helpers.js';

const cfg = loadVantageConfig();
const route = cfg.routes[0]!;
const isSmoke = process.env.VANTAGE_SMOKE === '1';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

test.describe('emulated media', () => {
  test.skip(isSmoke, '--smoke runs only the smoke + a11y specs');
  test(`prefers-reduced-motion: reduce on ${route.name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoRoute(page, route);
    if (cfg.readyMarker) await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });
    const matches = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    expect(matches, 'emulation did not propagate to matchMedia').toBeTruthy();
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`prefers-color-scheme: ${scheme} on ${route.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoRoute(page, route);
      if (cfg.readyMarker) await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });
      const matches = await page.evaluate(
        (s) => window.matchMedia(`(prefers-color-scheme: ${s})`).matches,
        scheme
      );
      expect(matches, `${scheme} mode emulation did not propagate`).toBeTruthy();

      // Sweep axe under this scheme — contrast issues often only show up
      // in dark mode.
      const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
      const disabled = cfg.axeDisabled.map((d) => d.rule);
      if (disabled.length > 0) builder.disableRules(disabled);
      const results = await builder.analyze();
      const real = results.violations.filter((v: Result) => v.id !== 'color-contrast'); // contrast handled in main a11y spec
      expect(real, `axe violations under ${scheme} mode`).toEqual([]);
    });
  }

  test(`prefers-contrast: more on ${route.name}`, async ({ page, browserName }) => {
    // WebKit's `prefers-contrast` support is incomplete; skip rather than
    // assert flakily.
    test.skip(
      browserName === 'webkit',
      'WebKit prefers-contrast emulation is unreliable — see playwright issue #28728'
    );
    await page.emulateMedia({ contrast: 'more' });
    await gotoRoute(page, route);
    if (cfg.readyMarker) await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });
    const matches = await page.evaluate(
      () => window.matchMedia('(prefers-contrast: more)').matches
    );
    expect(matches, 'prefers-contrast: more did not propagate').toBeTruthy();
  });

  test(`forced-colors: active on ${route.name}`, async ({ page, browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'forced-colors emulation is Chromium-only — see playwright issue #33765'
    );
    await page.emulateMedia({ forcedColors: 'active' });
    await gotoRoute(page, route);
    if (cfg.readyMarker) await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });
    const matches = await page.evaluate(
      () => window.matchMedia('(forced-colors: active)').matches
    );
    expect(matches, 'forced-colors emulation did not propagate').toBeTruthy();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .disableRules(cfg.axeDisabled.map((d) => d.rule))
      .analyze();
    // Forced-colors mode disables custom colours — axe rules around
    // contrast become noisy; we only flag NON-contrast violations.
    const real = results.violations.filter((v: Result) => v.id !== 'color-contrast');
    expect(real, 'axe violations under forced-colors').toEqual([]);
  });

  test(`print stylesheet on ${route.name}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ media: 'print' });
    await gotoRoute(page, route);
    if (cfg.readyMarker) await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });

    // Capture a screenshot under print media for visual diff in the report.
    const png = await page.screenshot({ fullPage: true });
    await testInfo.attach('print-screenshot', { body: png, contentType: 'image/png' });

    // Print stylesheets often hide nav/cookie banners; axe sweep ensures
    // what remains is still navigable.
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
    const disabled = cfg.axeDisabled.map((d) => d.rule);
    if (disabled.length > 0) builder.disableRules(disabled);
    const results = await builder.analyze();
    expect(results.violations, 'axe violations under print media').toEqual([]);
  });
});
