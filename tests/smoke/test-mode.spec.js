// @ts-check
// Test customer mode smoke tests.
// Verifies that test inquiries are filtered from default dashboard views.
// Does NOT create real test inquiries against production KV.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

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
  await page.locator('.nav-item', { hasText: 'Inquiries' }).click();
  // Button should not exist in DOM (flag is off)
  const btn = page.locator('#tm-create-btn');
  await expect(btn).not.toBeVisible();
});

test('inquiries page does not show test- prefixed cards by default', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('.nav-item', { hasText: 'Inquiries' }).click();
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
