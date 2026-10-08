import { devices, type ViewportSize } from '@playwright/test';
import type { ViewportName } from './types.js';

export interface ViewportProfile {
  name: ViewportName;
  viewport: ViewportSize;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  userAgent?: string;
}

/**
 * Build the five vantage viewport profiles. We re-use Playwright's `devices`
 * descriptors where they exist so the viewport matches a real-world device
 * (DPR, touch, UA) rather than just a width.
 *
 * mobile-320 is a custom profile — no Playwright descriptor maps exactly,
 * and small-screen breakpoint coverage matters for responsive design.
 */
export function buildViewportProfiles(): Record<ViewportName, ViewportProfile> {
  // mobile-375 is a 375-CSS-px profile, so it must come from a 375-wide
  // descriptor; iPhone 13 is 390 wide.
  const iPhone13Mini = devices['iPhone 13 Mini'];
  const iPadGen7 = devices['iPad (gen 7)'];

  if (!iPhone13Mini || !iPadGen7) {
    throw new Error(
      'vantage: Playwright `devices` is missing iPhone 13 Mini or iPad (gen 7). ' +
        'Upgrade @playwright/test to >=1.50.0.'
    );
  }

  return {
    'mobile-320': {
      // No descriptor in Playwright `devices` maps to 320 wide; this profile
      // exists to exercise responsive breakpoints on the smallest common
      // viewport. Don't pin a vendor UA — let the engine supply its own
      // mobile UA so the profile is engine-agnostic.
      name: 'mobile-320',
      viewport: { width: 320, height: 568 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    'mobile-375': {
      name: 'mobile-375',
      viewport: iPhone13Mini.viewport,
      deviceScaleFactor: iPhone13Mini.deviceScaleFactor,
      isMobile: iPhone13Mini.isMobile,
      hasTouch: iPhone13Mini.hasTouch,
      userAgent: iPhone13Mini.userAgent,
    },
    'tablet-768': {
      name: 'tablet-768',
      viewport: iPadGen7.viewport,
      deviceScaleFactor: iPadGen7.deviceScaleFactor,
      isMobile: iPadGen7.isMobile,
      hasTouch: iPadGen7.hasTouch,
      userAgent: iPadGen7.userAgent,
    },
    'desktop-1280': {
      name: 'desktop-1280',
      viewport: { width: 1280, height: 800 },
    },
    'desktop-1920': {
      name: 'desktop-1920',
      viewport: { width: 1920, height: 1080 },
    },
  };
}

export const ALL_VIEWPORTS: ViewportName[] = [
  'mobile-320',
  'mobile-375',
  'tablet-768',
  'desktop-1280',
  'desktop-1920',
];
