// @ts-check
// Flag-state mock helper for Playwright specs.
//
// Background: smoke / journey specs that assert on flag-gated UI used to depend
// on whatever state /api/flags returned from prod KV. When prod flag state
// drifted from the seed default (e.g. nav_v2 was default:true in flags.js but
// disabled:false in KV), every spec that asserted on the gated UI failed —
// taking out 16+ PRs at a time. This is the same drift class that PR #107 hit
// for customer_profile_v2.
//
// Solution: each spec mocks the /api/flags response with the flag state it
// needs. The spec asserts on the BEHAVIOR with that flag state, not on
// whatever KV happens to hold. Production drift can no longer break CI.
//
// This mirrors the inline pattern that was already in tests/smoke/nav-v2.spec.js
// and several journey specs — the helper just removes the boilerplate so the
// pattern is the obvious thing to reach for in new specs.
//
// Usage:
//   const { mockFlagState } = require('../helpers/mock-flags');
//   ...
//   await mockFlagState(page, { nav_v2: true, customer_profile_v2: false });
//   await page.goto(BASE_URL);
//
// Notes:
// - Pass `overrides` as a plain object: { flag_name: boolean }.
// - Flags not in `overrides` pass through unchanged from the upstream response.
// - If a flag in `overrides` isn't present in the upstream response (e.g. a
//   newly-seeded flag the prod deploy doesn't know about yet), the helper
//   appends it to the array so the client sees the override.
// - The mock is intercepted at the browser layer (page.route), so it only
//   affects the test's page context — KV is never touched.

/**
 * Override specific flags in the response from /api/flags for this page context.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, boolean>} overrides map of flag name → desired enabled state
 */
async function mockFlagState(page, overrides) {
  if (!overrides || typeof overrides !== 'object') {
    throw new Error('mockFlagState: overrides must be an object of { flagName: boolean }');
  }
  for (const [name, val] of Object.entries(overrides)) {
    if (typeof val !== 'boolean') {
      throw new Error(`mockFlagState: override for "${name}" must be boolean, got ${typeof val}`);
    }
  }

  await page.route('**/api/flags', async (route) => {
    let upstream;
    try {
      upstream = await route.fetch();
    } catch {
      // If the upstream call fails entirely, fulfill with a synthetic response
      // built only from the overrides — better than letting the test hang.
      const synthetic = Object.entries(overrides).map(([name, enabled]) => ({
        name, enabled, description: '', created_at: null,
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, flags: synthetic }),
      });
      return;
    }

    let body;
    try {
      body = await upstream.json();
    } catch {
      body = { ok: true, flags: [] };
    }

    const flags = Array.isArray(body && body.flags) ? body.flags.slice() : [];
    const seen = new Set();
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      if (!f || typeof f.name !== 'string') continue;
      if (Object.prototype.hasOwnProperty.call(overrides, f.name)) {
        flags[i] = Object.assign({}, f, { enabled: overrides[f.name] });
        seen.add(f.name);
      }
    }
    for (const [name, enabled] of Object.entries(overrides)) {
      if (!seen.has(name)) {
        flags.push({ name, enabled, description: '', created_at: null });
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(Object.assign({}, body, { ok: true, flags })),
    });
  });
}

module.exports = { mockFlagState };
