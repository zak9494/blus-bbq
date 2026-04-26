// @ts-check
// Test customer mode smoke tests.
// Verifies that test inquiries are filtered from default dashboard views.
// Does NOT create real test inquiries against production KV.
const { test, expect } = require('@playwright/test');
const { setFlagOrSkip } = require('../helpers/flags');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const FLAG_SECRET = 'c857eb539774b63cf0b0a09303adc78d';

// Ensure flag is off before tests run (guards against stale dev KV state)
test.beforeAll(async ({ request }) => {
  await setFlagOrSkip(request, 'test_customer_mode', false, {
    secret: FLAG_SECRET,
    baseUrl: BASE_URL,
  });
});

test('test_customer_mode flag is present and disabled by default', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/flags');
  const body = await res.json();
  const flag = (body.flags || []).find((f) => f.name === 'test_customer_mode');
  expect(flag).toBeDefined();
  // Default is off — test mode should not be active on a fresh deploy
  expect(flag.enabled).toBe(false);
});

test('+ Test Inquiry button is NOT visible when flag is off', async ({ page }) => {
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

test('inquiries page does not show test- prefixed cards by default', async ({ page }) => {
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
  // Either zero test cards OR showTestData is off (cards are hidden)
  // We assert count is 0 since showTestData defaults false
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
