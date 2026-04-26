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

test('Feature Flags page is accessible', async ({ page }) => {
  // Feature Flags has no nav_v2 button — verify page is reachable via showPage()
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('flags');
  });
  await expect(page.locator('#page-flags')).toBeVisible({ timeout: 5000 });
});

test('Feature Flags page renders flag list on navigation', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('flags');
  });
  await expect(page.locator('#page-flags')).toBeVisible({ timeout: 5000 });
  // Wait for async load — flags-list should become visible
  await expect(page.locator('#flags-list')).toBeVisible({ timeout: 8000 });
});

// Secret is the same hardcoded value used in index.html (not an actual secret).
const FLAG_SECRET = 'c857eb539774b63cf0b0a09303adc78d';

test('POST /api/flags/:name returns 200 (routing fix regression guard)', async ({ request }) => {
  // Write kanban_restructure=false (no-op: it was already false). Verifies the route exists.
  const res = await request.post(BASE_URL + '/api/flags/kanban_restructure', {
    data: { secret: FLAG_SECRET, enabled: false, description: 'Restructured kanban board layout' },
  });

  // Tolerate Upstash KV quota exhaustion: the route still exists and reaches
  // the handler (which is what this regression guard checks); it just can't
  // commit the write until the quota resets or the plan is upgraded. Without
  // this branch every flag-related test would red-flag CI whenever KV runs
  // out of credits, even though the routing/handler is fine.
  const text = await res.text();
  if (res.status() === 500 && /max requests limit exceeded/i.test(text)) {
    test.skip(true, `Upstash KV at quota — POST handler reached but cannot write. body=${text.slice(0, 200)}`);
  }

  expect(res.status(), `POST returned ${res.status()} body=${text.slice(0, 200)}`).toBe(200);
  const body = JSON.parse(text);
  expect(body).toHaveProperty('ok', true);
  expect(body.name).toBe('kanban_restructure');
  expect(body.enabled).toBe(false);
});

test('POST /api/flags/:name rejects wrong secret with 401', async ({ request }) => {
  const res = await request.post(BASE_URL + '/api/flags/kanban_restructure', {
    data: { secret: 'wrong', enabled: false },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/flags/:name rejects missing enabled with 400', async ({ request }) => {
  const res = await request.post(BASE_URL + '/api/flags/kanban_restructure', {
    data: { secret: FLAG_SECRET },
  });
  expect(res.status()).toBe(400);
});
