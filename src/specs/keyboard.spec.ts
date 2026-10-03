import { test, expect } from '@playwright/test';
import { gotoRoute, loadVantageConfig } from './_helpers.js';

const cfg = loadVantageConfig();
const isSmoke = process.env.VANTAGE_SMOKE === '1';

/**
 * Pick a representative route — first one configured — and walk the focus
 * order with the Tab key, asserting that every interactive landing point
 * is reachable AND that :focus-visible renders a non-trivial outline.
 *
 * "Walk the whole site" is intentionally not what this spec does: real
 * keyboard reviews need a human. vantage asserts the floor (focus is
 * reachable + visible), not the ceiling (logical tab order, escape from
 * traps, etc.).
 */
const representativeRoute = cfg.routes[0]!;

test.describe('keyboard', () => {
  test.skip(isSmoke, '--smoke runs only the smoke + a11y specs');
  test(`tab walk on ${representativeRoute.name}`, async ({ page, browserName }) => {
    await gotoRoute(page, representativeRoute);
    if (cfg.readyMarker) {
      await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });
    }

    // Capture the maximum reachable focus depth. We stop when Tab no longer
    // moves the focus (i.e. we have cycled), or after a generous safety cap.
    const MAX_TABS = 50;
    const seen = new Set<string>();
    let consecutiveStuck = 0;

    // Park focus at the top.
    await page.locator('body').focus().catch(() => undefined);
    await page.keyboard.press('Tab');

    for (let i = 0; i < MAX_TABS; i++) {
      const fp = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a) return null;
        const tag = a.tagName.toLowerCase();
        const id = a.id ? `#${a.id}` : '';
        const cls = a.className && typeof a.className === 'string' ? `.${a.className.split(/\s+/).join('.')}` : '';
        const text = (a.textContent || '').trim().slice(0, 40);
        return `${tag}${id}${cls}::${text}`;
      });
      if (fp === null) break;
      if (seen.has(fp)) {
        consecutiveStuck++;
        if (consecutiveStuck >= 3) break;
      } else {
        consecutiveStuck = 0;
        seen.add(fp);
      }
      await page.keyboard.press('Tab');
    }

    // Minimum-floor assertion: at least ONE thing was reachable. A page
    // with literally zero tab stops is suspicious (no skip link, no
    // header nav, no main interactive content).
    expect(
      seen.size,
      `no focusable elements reached via Tab on ${representativeRoute.path}. ` +
        'Pages should expose at least a skip-link or top-of-content focus target.'
    ).toBeGreaterThan(0);

    // :focus-visible rendering check on the currently-focused element.
    // We can't trivially screenshot-diff cross-engine, so we assert via
    // computed style: there must be SOME outline OR box-shadow on focus.
    const hasFocusIndicator = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return true; // body focus has no expected indicator
      const cs = getComputedStyle(a);
      // Border is unreliable as a focus signal — native <button>/<input>
      // ship with non-zero borders unfocused, so a border check passes even
      // when there is no :focus rule. Only outline + boxShadow count.
      const outline = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
      const ring = cs.boxShadow !== '' && cs.boxShadow !== 'none';
      return outline || ring;
    });
    expect(
      hasFocusIndicator,
      `focused element has no visible focus indicator on ${representativeRoute.path} (${browserName}). ` +
        'Set :focus-visible styles in your CSS — never `outline: none` without a replacement.'
    ).toBeTruthy();
  });
});
