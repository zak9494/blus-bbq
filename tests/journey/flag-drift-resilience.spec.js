// @ts-check
// Regression spec: prove that mockFlagState() takes priority over whatever
// /api/flags returns from prod KV. If this spec ever fails, the mock helper
// regressed and we are back to depending on prod state in CI — exactly the
// drift class that PR #122 (nav_v2) and PR #107 (customer_profile_v2) hit.
//
// Strategy: pick a flag, fetch /api/flags ourselves to learn what prod actually
// returns, then mock that flag to the OPPOSITE state in the page context and
// confirm window.flags.isEnabled() reflects the mock — not prod. This catches
// every realistic regression of the helper:
//   - mock fails to install (we'd see prod state instead of opposite)
//   - mock returns the wrong shape (window.flags rejects it, falls back)
//   - mock only matches a subset of /api/flags request paths
//
// We use customer_profile_v2 as the canary because it's a real seeded flag
// that Zach actively flips. Any flag would do — the test asserts mock
// priority, not the flag's behavior.
const { test, expect } = require('@playwright/test');
const { mockFlagState } = require('../helpers/mock-flags');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const CANARY_FLAG = 'customer_profile_v2';

test.describe('flag-drift resilience: mockFlagState priority over prod KV', () => {
  test('mock takes priority when prod has the OPPOSITE state', async ({ page, request }) => {
    // Step 1: ask prod what state the canary flag is currently in.
    const probe = await request.get(BASE_URL + '/api/flags');
    expect(probe.status()).toBe(200);
    const probeBody = await probe.json();
    const prodFlag = (probeBody.flags || []).find((f) => f.name === CANARY_FLAG);
    expect(prodFlag, `${CANARY_FLAG} must exist in /api/flags for this regression to be meaningful`).toBeTruthy();

    // Step 2: pick the OPPOSITE of whatever prod returned. This is the value
    // window.flags should report after our mock takes over.
    const target = !prodFlag.enabled;

    // Step 3: install the mock and load the app.
    await mockFlagState(page, { [CANARY_FLAG]: target });
    await page.goto(BASE_URL);
    await page.evaluate(async () => {
      if (window.flags && typeof window.flags.load === 'function') await window.flags.load();
    });

    // Step 4: window.flags.isEnabled should match the mock, NOT prod.
    const seen = await page.evaluate((name) => {
      if (!window.flags || typeof window.flags.isEnabled !== 'function') return null;
      return window.flags.isEnabled(name);
    }, CANARY_FLAG);

    expect(seen, 'window.flags should report the mocked value, not the prod KV value').toBe(target);
    expect(seen, 'mocked value must differ from prod (drift simulation)').not.toBe(prodFlag.enabled);
  });

  test('overrides for unknown flags are appended to the response', async ({ page }) => {
    // A spec might mock a flag the upstream prod deploy doesn't seed yet
    // (e.g. brand-new feature flag added in the same PR as the test). The
    // helper should append it to the flags array so window.flags sees it.
    const fakeName = 'mock_flags_regression_canary_zzz';
    await mockFlagState(page, { [fakeName]: true });
    await page.goto(BASE_URL);
    await page.evaluate(async () => {
      if (window.flags && typeof window.flags.load === 'function') await window.flags.load();
    });

    const seen = await page.evaluate((name) => {
      if (!window.flags || typeof window.flags.isEnabled !== 'function') return null;
      return window.flags.isEnabled(name);
    }, fakeName);

    expect(seen, 'unknown-flag override should be appended and reported as enabled').toBe(true);
  });

  test('flags not in overrides pass through from upstream unchanged', async ({ page, request }) => {
    // Mocking nav_v2 should not affect customer_profile_v2's reported state.
    const probe = await request.get(BASE_URL + '/api/flags');
    const probeBody = await probe.json();
    const otherFlag = (probeBody.flags || []).find((f) => f.name === CANARY_FLAG);
    expect(otherFlag).toBeTruthy();

    await mockFlagState(page, { nav_v2: false });
    await page.goto(BASE_URL);
    await page.evaluate(async () => {
      if (window.flags && typeof window.flags.load === 'function') await window.flags.load();
    });

    const seen = await page.evaluate((name) => {
      if (!window.flags || typeof window.flags.isEnabled !== 'function') return null;
      return window.flags.isEnabled(name);
    }, CANARY_FLAG);

    expect(seen, 'unmocked flags should pass through unchanged from prod').toBe(otherFlag.enabled);
  });
});
