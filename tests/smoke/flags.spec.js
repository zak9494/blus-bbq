// @ts-check
// Feature flags smoke tests — shape verification only (no KV writes in CI).
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

const EXPECTED_SEED_FLAGS = [
  'kanban_restructure',
  'notifications_center',
  'ai_quote_updates',
  'test_customer_mode',
  'sms_channel',
  'deposit_tracking',
];

test('GET /api/flags returns 200 with flags array', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/flags');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(Array.isArray(body.flags)).toBe(true);
});

test('flags array contains all 6 seeded flag names', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/flags');
  const body = await res.json();
  const names = (body.flags || []).map((f) => f.name);
  for (const expected of EXPECTED_SEED_FLAGS) {
    expect(names).toContain(expected);
  }
});

test('each flag has required shape fields', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/flags');
  const body = await res.json();
  for (const flag of body.flags || []) {
    expect(typeof flag.name).toBe('string');
    expect(typeof flag.enabled).toBe('boolean');
    expect(typeof flag.description).toBe('string');
  }
});

test('Feature Flags nav item is present in sidebar', async ({ page }) => {
  await page.goto(BASE_URL);
  const flagsBtn = page.locator('.nav-item', { hasText: 'Feature Flags' });
  await expect(flagsBtn).toBeVisible();
});

test('Feature Flags page renders flag list on navigation', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('.nav-item', { hasText: 'Feature Flags' }).click();
  await expect(page.locator('#page-flags')).toBeVisible();
  // Wait for async load — flags-list should become visible
  await expect(page.locator('#flags-list')).toBeVisible({ timeout: 8000 });
});
