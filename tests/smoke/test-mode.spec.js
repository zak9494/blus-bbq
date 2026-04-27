// @ts-check
// Test customer mode smoke tests.
// Verifies that test inquiries are filtered from default dashboard views.
// Does NOT create real test inquiries against production KV.
const { test, expect } = require('@playwright/test');
const { mockFlagState } = require('../helpers/mock-flags');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

// Note: previously this file used setFlagOrSkip() to flip prod KV before the
// tests ran. That meant CI was actively writing to KV (burning quota) and
// asserting on prod state (vulnerable to drift). The structural fix is to
// mock /api/flags per page context — see PR #122 for the drift incident and
// tests/helpers/mock-flags.js for the helper.

test('test_customer_mode flag is present in /api/flags response', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/flags');
  const body = await res.json();
  const flag = (body.flags || []).find((f) => f.name === 'test_customer_mode');
  expect(flag).toBeDefined();
  // Don't assert the enabled value — Zach may flip in prod and CI shouldn't
  // care. UI behavior is exercised below with mockFlagState() instead.
  expect(typeof flag.enabled).toBe('boolean');
});

test('+ Test Inquiry button is NOT visible when flag is off', async ({ page }) => {
  await mockFlagState(page, { test_customer_mode: false });
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('inquiries');
  });
  await expect(page.locator('#page-inquiries')).toBeVisible({ timeout: 5000 });
  // Button should not exist in DOM (flag is off)
  const btn = page.locator('#tm-create-btn');
  await expect(btn).not.toBeVisible();
});

test('inquiries page does not show test- prefixed cards when flag is off', async ({ page }) => {
  await mockFlagState(page, { test_customer_mode: false });
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('inquiries');
  });
  await expect(page.locator('#page-inquiries')).toBeVisible({ timeout: 5000 });
  // Wait for inquiries to load
  await page.waitForTimeout(2000);
  // No card should have the TEST badge visible
  const testBadges = page.locator('.inq-card', { hasText: 'TEST' });
  expect(await testBadges.count()).toBe(0);
});

test('POST /api/inquiries/test requires auth', async ({ request }) => {
  const res = await request.post(BASE_URL + '/api/inquiries/test', {
    data: { secret: 'wrong-secret' },
  });
  expect(res.status()).toBe(401);
});

test('GET /api/settings/test-mode-email returns expected shape', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/settings/test-mode-email');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('email');
  // email is either null or a non-empty string
  expect(body.email === null || typeof body.email === 'string').toBe(true);
});
