// @ts-check
// ============================================================
// SMOKE TEST TEMPLATE — copy this file to add a new group.
//
// Naming convention: <feature>.spec.js
// All files in tests/smoke/ are run by smoke.yml automatically.
//
// Usage:
//   cp tests/smoke/_template.spec.js tests/smoke/my-feature.spec.js
//   # Edit the tests below, then push — CI picks them up automatically.
// ============================================================

// const { test, expect } = require('@playwright/test');
//
// const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
//
// // ── API shape check ────────────────────────────────────────────────────────
// test('GET /api/my-endpoint returns 200', async ({ request }) => {
//   const res = await request.get(BASE_URL + '/api/my-endpoint');
//   expect(res.status()).toBe(200);
//   const body = await res.json();
//   expect(body).toHaveProperty('ok', true);
// });
//
// // ── UI navigation ──────────────────────────────────────────────────────────
// test('My Feature nav item is present', async ({ page }) => {
//   await page.goto(BASE_URL);
//   const btn = page.locator('.nav-item', { hasText: 'My Feature' });
//   await expect(btn).toBeVisible();
// });
//
// // ── Feature behaviour ──────────────────────────────────────────────────────
// test('my feature does the thing', async ({ page }) => {
//   await page.goto(BASE_URL);
//   // ... interactions and assertions
// });
