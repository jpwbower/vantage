import { test, type Page, type Response } from '@playwright/test';
import path from 'node:path';
import type {
  VantageNetworkPreset,
  VantageNetworkPresetCustom,
  ResolvedVantageConfig,
  VantageRoute,
} from '../types.js';

/** Refuse content verdicts when the final document response is not 2xx. */
export function assertRouteResponse(
  route: VantageRoute,
  status: number | null,
  spec: string
): void {
  if (status === null || status < 200 || status >= 300) {
    throw new Error(
      `route ${route.name} (${route.path}) returned HTTP ${status ?? 'no response'} — ` +
        `the page did not render, so no ${spec} verdict was taken; check the web server log`
    );
  }
}

export async function gotoRoute(page: Page, route: VantageRoute): Promise<Response> {
  const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
  const spec = path.basename(test.info().file).replace(/\.spec\.[jt]s$/, '');
  assertRouteResponse(route, response?.status() ?? null, spec);
  return response!;
}

interface SerialisedRegExp {
  source: string;
  flags: string;
}
interface SerialisedConfig extends Omit<ResolvedVantageConfig, 'consoleIgnore'> {
  consoleIgnore: SerialisedRegExp[];
}

/**
 * Shared loader for the env-injected resolved config. Specs import this
 * instead of re-parsing VANTAGE_CONFIG_JSON themselves.
 */
export function loadVantageConfig(): ResolvedVantageConfig {
  const raw = process.env.VANTAGE_CONFIG_JSON;
  if (!raw) {
    throw new Error(
      'vantage spec: VANTAGE_CONFIG_JSON is not set. Run via `npx vantage`, not `playwright test`.'
    );
  }
  const parsed = JSON.parse(raw) as SerialisedConfig;
  return {
    ...parsed,
    consoleIgnore: parsed.consoleIgnore.map((r) => new RegExp(r.source, r.flags)),
  };
}

export function isCi(): boolean {
  return process.env.VANTAGE_CI === '1';
}

const PRESET_VALUES: Record<
  '3g-slow' | '3g-fast' | '4g' | 'wifi',
  VantageNetworkPresetCustom
> = {
  '3g-slow': { downloadKbps: 400, uploadKbps: 400, latencyMs: 400 },
  '3g-fast': { downloadKbps: 1638, uploadKbps: 768, latencyMs: 150 },
  '4g': { downloadKbps: 9000, uploadKbps: 9000, latencyMs: 170 },
  wifi: { downloadKbps: 30000, uploadKbps: 15000, latencyMs: 2 },
};

function resolvePreset(preset: VantageNetworkPreset): VantageNetworkPresetCustom {
  if (typeof preset === 'string') return PRESET_VALUES[preset];
  return preset;
}

const warnedEngines = new Set<string>();

/**
 * Apply CDP-based network throttling to a Playwright page. Chromium ONLY —
 * Firefox / WebKit do not expose the same CDP shape. On non-chromium engines
 * we emit a console.warn ONCE per engine (the test still proceeds at full
 * bandwidth — bandwidth doesn't affect a11y or smoke signal strongly
 * enough to justify a skip).
 *
 * Call this AFTER context creation and BEFORE the first navigation so the
 * initial request is throttled too.
 */
export async function applyNetworkPreset(
  page: Page,
  cfg: ResolvedVantageConfig
): Promise<void> {
  if (!cfg.networkPreset) return;
  const engine = page.context().browser()?.browserType().name() ?? 'unknown';
  if (engine !== 'chromium') {
    if (!warnedEngines.has(engine)) {
      warnedEngines.add(engine);
      process.stderr.write(
        `[vantage] networkPreset is Chromium-only; ignoring for ${engine}.\n`
      );
    }
    return;
  }
  const { downloadKbps, uploadKbps, latencyMs } = resolvePreset(cfg.networkPreset);
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: kbpsToBytesPerSec(downloadKbps),
    uploadThroughput: kbpsToBytesPerSec(uploadKbps),
    latency: latencyMs,
  });
}

function kbpsToBytesPerSec(kbps: number): number {
  // CDP expects bytes/sec. kbps → bits/sec (×1000) → bytes/sec (÷8).
  return Math.round((kbps * 1000) / 8);
}
