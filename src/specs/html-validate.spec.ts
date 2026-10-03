import { test, expect } from '@playwright/test';
import { assertRouteResponse, gotoRoute, loadVantageConfig } from './_helpers.js';

const cfg = loadVantageConfig();
const isRelease = process.env.VANTAGE_RELEASE === '1';

/**
 * Strict HTML validation via html-validate.
 *
 * Why --release-gated:
 *   html-validate is strict — modern frameworks ship a non-trivial
 *   number of "harmless" violations (e.g. `<div role="button">`
 *   without tabindex, `<a>` wrapping interactive content). Running it
 *   on every push would block work; running it pre-release once is
 *   the right cadence to catch genuine markup bugs.
 *
 * Two pass shapes:
 *   - Post-hydration (always runs): `page.content()` returns the
 *     outerHTML after framework hydration, which is what users (and
 *     assistive tech) actually see.
 *   - Raw response (opt-in via `cfg.htmlValidateRaw: true`): Node
 *     `fetch` against `baseURL + route.path`, validate the response
 *     body. Catches SSR markup bugs that the client rewrites before
 *     the post-hydration pass observes them. The raw fetch does NOT
 *     carry storageState cookies — that's by design; see the field's
 *     JSDoc for the auth-interaction rationale.
 *
 * Why a single project (not the engine x viewport matrix):
 *   The validated HTML is engine-agnostic and viewport-irrelevant for
 *   markup correctness. Running across the full matrix multiplies
 *   wallclock with zero new signal.
 *
 * Consumer config: drop an `.htmlvalidate.json` in your project root
 * to override rule defaults — html-validate auto-discovers it from
 * the consumer CWD.
 */

const SUPPORTED_PROJECT = 'chromium__desktop-1280';

type ValidateMessage = {
  ruleId: string;
  severity: number;
  message: string;
  line: number;
  column: number;
};
type ValidateReport = {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  results: { messages: ValidateMessage[] }[];
};
type HtmlValidateCtor = new (config?: unknown) => {
  validateString: (s: string) => Promise<ValidateReport>;
};

async function loadHtmlValidate(): Promise<HtmlValidateCtor | { skipReason: string }> {
  try {
    const mod = await import('html-validate');
    return mod.HtmlValidate as HtmlValidateCtor;
  } catch (err) {
    return {
      skipReason: `html-validate is not installed: ${
        err instanceof Error ? err.message : String(err)
      }. Run \`npm i -D html-validate\` in your project.`,
    };
  }
}

function joinUrl(base: string, p: string): string {
  if (/^https?:\/\//i.test(p)) return p;
  const baseTrimmed = base.replace(/\/+$/, '');
  const pathTrimmed = p.replace(/^\/+/, '');
  return `${baseTrimmed}/${pathTrimmed}`;
}

async function assertValidMarkup(
  validatorCtor: HtmlValidateCtor,
  html: string,
  routePath: string,
  passLabel: string
): Promise<void> {
  // No `config` argument — let html-validate auto-discover the
  // consumer's `.htmlvalidate.json` from their project root, falling
  // back to its own `recommended` preset.
  const validator = new validatorCtor();
  const report = await validator.validateString(html);

  if (!report.valid) {
    const errors = report.results
      .flatMap((r) => r.messages)
      .filter((m) => m.severity === 2)
      .map((m) => `  [${m.ruleId}] ${m.line}:${m.column} ${m.message}`)
      .join('\n');
    expect(
      report.errorCount,
      `html-validate (${passLabel}) found ${report.errorCount} error(s) on ${routePath}:\n${errors}\n` +
        'See https://html-validate.org/rules/ for rule docs. ' +
        'Drop an .htmlvalidate.json in your project root to tune rule severity.'
    ).toBe(0);
  }
}

if (!isRelease) {
  test.describe('html-validate', () => {
    test.skip(true, '--release not set; skipping html-validate spec.');
    test('release-gated', () => {});
  });
} else {
  test.describe('html-validate', () => {
    for (const route of cfg.routes) {
      // When htmlValidateRaw is enabled, we emit TWO independent test
      // cases per route so each pass reports its result separately. When
      // disabled, the post-hydration test title preserves the v0.4
      // shape (`markup on $name ($path)`) for any CI dashboards keyed
      // on it.
      const postHydrationTitle = cfg.htmlValidateRaw
        ? `markup on ${route.name} (${route.path}) (post-hydration)`
        : `markup on ${route.name} (${route.path})`;

      test(postHydrationTitle, async ({ page }, testInfo) => {
        test.skip(
          testInfo.project.name !== SUPPORTED_PROJECT,
          `html-validate spec only runs on project "${SUPPORTED_PROJECT}" (HTML is engine-agnostic).`
        );
        testInfo.setTimeout(60_000);

        const loaded = await loadHtmlValidate();
        if ('skipReason' in loaded) {
          test.skip(true, loaded.skipReason);
          return;
        }

        await gotoRoute(page, route);
        if (cfg.readyMarker) {
          await page.waitForSelector(cfg.readyMarker, {
            state: 'attached',
            timeout: 30_000,
          });
        }
        const html = await page.content();
        await assertValidMarkup(loaded, html, route.path, 'post-hydration');
      });

      if (cfg.htmlValidateRaw) {
        test(`markup on ${route.name} (${route.path}) (raw response)`, async ({}, testInfo) => {
          test.skip(
            testInfo.project.name !== SUPPORTED_PROJECT,
            `html-validate spec only runs on project "${SUPPORTED_PROJECT}" (HTML is engine-agnostic).`
          );
          testInfo.setTimeout(60_000);

          const loaded = await loadHtmlValidate();
          if ('skipReason' in loaded) {
            test.skip(true, loaded.skipReason);
            return;
          }

          // Node fetch follows redirects by default — matches what
          // html-validate would see if a browser navigated here. We
          // deliberately do not forward storageState cookies; on an
          // authenticated route this surfaces the unauthenticated
          // successful response body (such as login markup), which IS the
          // useful signal — see cfg.htmlValidateRaw JSDoc.
          const url = joinUrl(cfg.baseURL, route.path);
          let bodyText: string;
          try {
            const res = await fetch(url);
            assertRouteResponse(route, res.status, 'html-validate (raw response)');
            bodyText = await res.text();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Surface as test failure, not skip — fetch failure is a
            // signal worth reporting (route unreachable from the Node
            // process running the test, even though the browser
            // navigation succeeded). Thrown as Error so Playwright's
            // failure-line reads as a real error message rather than
            // the misleading "Expected: 'reachable' / Received: undefined"
            // shape that an expect().toBe assertion would produce.
            throw new Error(`raw-response fetch of ${url} failed: ${msg}`);
          }

          await assertValidMarkup(loaded, bodyText, route.path, 'raw response');
        });
      }
    }
  });
}
