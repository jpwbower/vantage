import { test, expect } from '@playwright/test';
import { gotoRoute, loadVantageConfig } from './_helpers.js';

const cfg = loadVantageConfig();
const route = cfg.routes[0]!;
const isSmoke = process.env.VANTAGE_SMOKE === '1';

/**
 * Accessibility-name sanity sweep — the "virtual screen reader" check.
 *
 * Walks every interactive element on the page and asserts each has an
 * accessible name a screen reader can announce. The name is derived in
 * the page context using the platform-standard sources (in order):
 *   1. aria-labelledby → text of the referenced elements
 *   2. aria-label
 *   3. associated <label> (for form controls)
 *   4. visible text content
 *   5. title attribute (last resort — discouraged but real)
 *   6. for <img>: alt
 *
 * This is intentionally NOT a real-AT integration. Real NVDA / JAWS /
 * VoiceOver coverage arrives in v0.2 via Guidepup proper (needs OS-level
 * setup that triggers UAC / SmartScreen on Windows). The structural
 * check below catches the most common bug — `<button><svg/></button>`
 * with no name — without that friction.
 */
test.describe('a11y tree walk (virtual screen reader equivalent)', () => {
  test.skip(isSmoke, '--smoke runs only the smoke + a11y specs');
  test(`accessible-name sweep on ${route.name}`, async ({ page }) => {
    await gotoRoute(page, route);
    if (cfg.readyMarker) await page.waitForSelector(cfg.readyMarker, { state: 'attached', timeout: 30_000 });

    await page.waitForTimeout(250);

    const nameless = await page.evaluate(() => {
      const interactiveSelector = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="textbox"]',
        '[role="switch"]',
        '[role="combobox"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="option"]',
        '[role="slider"]',
        '[role="spinbutton"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      const isVisible = (el: Element): boolean => {
        const cs = (el.ownerDocument!.defaultView ?? window).getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        if ((el as HTMLElement).hidden) return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        return true;
      };

      const accessibleName = (el: Element): string => {
        const h = el as HTMLElement;

        // aria-labelledby resolution
        const labelledBy = h.getAttribute('aria-labelledby');
        if (labelledBy) {
          const parts = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter((n): n is HTMLElement => n !== null)
            .map((n) => (n.textContent ?? '').trim())
            .filter((s) => s.length > 0);
          if (parts.length > 0) return parts.join(' ');
        }

        // aria-label
        const ariaLabel = h.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

        // <label for=...> or wrapping <label>
        if (h instanceof HTMLInputElement || h instanceof HTMLSelectElement || h instanceof HTMLTextAreaElement) {
          const id = h.id;
          if (id) {
            const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (lbl && (lbl.textContent ?? '').trim()) return (lbl.textContent ?? '').trim();
          }
          const parent = h.closest('label');
          if (parent && (parent.textContent ?? '').trim()) return (parent.textContent ?? '').trim();
        }

        // <img alt>
        if (h instanceof HTMLImageElement && h.alt) return h.alt;

        // visible text
        const text = (h.textContent ?? '').trim();
        if (text) return text;

        // title fallback
        const title = h.getAttribute('title');
        if (title && title.trim()) return title.trim();

        return '';
      };

      const findings: { selector: string; role: string }[] = [];
      const elements = Array.from(document.querySelectorAll(interactiveSelector));
      for (const el of elements) {
        if (!isVisible(el)) continue;
        // Decorative / presentational override
        if (el.getAttribute('role') === 'presentation' || el.getAttribute('role') === 'none') continue;

        const name = accessibleName(el);
        if (name.length === 0) {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') ?? tag;
          // Build a stable selector hint
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string'
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
          findings.push({ selector: `${tag}${id}${cls}`, role });
        }
      }
      return findings;
    });

    const report = nameless.map((n) => `  ${n.role}  ${n.selector}`).join('\n');
    expect(
      nameless,
      `interactive elements with no accessible name on ${route.path}:\n${report || '(none)'}\n` +
        'Add aria-label, aria-labelledby, an associated <label>, or visible text. ' +
        'A screen reader user will hear these as bare role announcements with no further information.'
    ).toEqual([]);
  });
});
