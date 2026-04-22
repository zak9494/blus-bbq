// @ts-check
/**
 * Smoke tests for Group 6 AI backend endpoints.
 * Tests endpoint contracts without UI — using request API only.
 * Run against the Vercel preview URL:
 *   SMOKE_BASE_URL=https://<preview>.vercel.app npx playwright test tests/smoke/ai-endpoints.spec.js
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const GMAIL_SECRET = process.env.SMOKE_GMAIL_SECRET || '';
const SELF_MODIFY_SECRET = process.env.SMOKE_SELF_MODIFY_SECRET || '';

// ── /api/ai/quote-updates (flag-gated) ─────────────────────────────────────

test('GET /api/ai/quote-updates → 404 when flag is off', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/ai/quote-updates`);
  // Flag defaults to off → 404
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('GET /api/ai/quote-updates with flag on → 200 + correct shape', async ({ request }) => {
  // This test only runs when SMOKE_SELF_MODIFY_SECRET is set and flag is manually toggled on
  // In CI it is skipped; for manual verification, set the env and toggle the flag
  test.skip(!SELF_MODIFY_SECRET, 'Requires SMOKE_SELF_MODIFY_SECRET to toggle flag');

  // Enable flag
  const flagRes = await request.post(`${BASE_URL}/api/flags/ai_quote_updates`, {
    data: { secret: SELF_MODIFY_SECRET, enabled: true, description: 'smoke test' },
  });
  expect(flagRes.status()).toBe(200);

  // Now check the endpoint
  const res = await request.get(`${BASE_URL}/api/ai/quote-updates`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body).toHaveProperty('suggestions');
  expect(Array.isArray(body.suggestions)).toBe(true);
  expect(body).toHaveProperty('stats');
  expect(body.stats).toHaveProperty('pending');

  // Disable flag again to leave clean
  await request.post(`${BASE_URL}/api/flags/ai_quote_updates`, {
    data: { secret: SELF_MODIFY_SECRET, enabled: false, description: 'smoke test' },
  });
});

// ── /api/settings/guest-count-lockin ───────────────────────────────────────

test('GET /api/settings/guest-count-lockin → 200 + { ok, days }', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/settings/guest-count-lockin`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body).toHaveProperty('days');
  expect(typeof body.days).toBe('number');
});

test('POST /api/settings/guest-count-lockin without secret → 401', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/settings/guest-count-lockin`, {
    data: { days: 7 },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/settings/guest-count-lockin with secret → 200', async ({ request }) => {
  test.skip(!SELF_MODIFY_SECRET, 'Requires SMOKE_SELF_MODIFY_SECRET');
  const res = await request.post(`${BASE_URL}/api/settings/guest-count-lockin`, {
    data: { secret: SELF_MODIFY_SECRET, days: 7 },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body.days).toBe(7);

  // Reset to 0
  await request.post(`${BASE_URL}/api/settings/guest-count-lockin`, {
    data: { secret: SELF_MODIFY_SECRET, days: 0 },
  });
});

// ── /api/ai/regenerate ─────────────────────────────────────────────────────

test('POST /api/ai/regenerate without secret → 401', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/ai/regenerate`, {
    data: { inquiryId: 'test-123', draftType: 'email' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/ai/regenerate with secret + missing inquiryId → 400', async ({ request }) => {
  test.skip(!GMAIL_SECRET, 'Requires SMOKE_GMAIL_SECRET');
  const res = await request.post(`${BASE_URL}/api/ai/regenerate`, {
    headers: { 'x-secret': GMAIL_SECRET },
    data: { draftType: 'email' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/inquiryId/i);
});

test('POST /api/ai/regenerate with secret + nonexistent inquiry → 404', async ({ request }) => {
  test.skip(!GMAIL_SECRET, 'Requires SMOKE_GMAIL_SECRET');
  const res = await request.post(`${BASE_URL}/api/ai/regenerate`, {
    headers: { 'x-secret': GMAIL_SECRET },
    data: { inquiryId: 'nonexistent-smoke-test-id', draftType: 'email' },
  });
  expect(res.status()).toBe(404);
});

// ── /api/ai/add-details ────────────────────────────────────────────────────

test('POST /api/ai/add-details without secret → 401', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/ai/add-details`, {
    data: { inquiryId: 'test-123', draftType: 'email', extraContext: 'test' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/ai/add-details missing extraContext → 400', async ({ request }) => {
  test.skip(!GMAIL_SECRET, 'Requires SMOKE_GMAIL_SECRET');
  const res = await request.post(`${BASE_URL}/api/ai/add-details`, {
    headers: { 'x-secret': GMAIL_SECRET },
    data: { inquiryId: 'test-123', draftType: 'email' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/extraContext/i);
});

// ── /api/ai/thank-you-draft ────────────────────────────────────────────────

test('POST /api/ai/thank-you-draft without secret → 401', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/ai/thank-you-draft`, {
    data: { inquiryId: 'test-123' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/ai/thank-you-draft with secret + nonexistent inquiry → 404', async ({ request }) => {
  test.skip(!GMAIL_SECRET, 'Requires SMOKE_GMAIL_SECRET');
  const res = await request.post(`${BASE_URL}/api/ai/thank-you-draft`, {
    headers: { 'x-secret': GMAIL_SECRET },
    data: { inquiryId: 'nonexistent-smoke-test-id' },
  });
  expect(res.status()).toBe(404);
});

// ── /api/ai/quote-update-scan (flag-gated) ─────────────────────────────────

test('POST /api/ai/quote-update-scan with flag off → 404', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/ai/quote-update-scan`, {
    data: { inquiryId: 'test-123' },
  });
  // Flag off → 404 before auth check
  expect(res.status()).toBe(404);
});

// ── /api/cron/post-event-archive ───────────────────────────────────────────

test('GET /api/cron/post-event-archive without secret → 401', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/cron/post-event-archive`);
  expect(res.status()).toBe(401);
});

test('GET /api/cron/post-event-archive dry_run with secret → 200', async ({ request }) => {
  test.skip(!GMAIL_SECRET, 'Requires SMOKE_GMAIL_SECRET');
  const res = await request.get(`${BASE_URL}/api/cron/post-event-archive?dry_run=1&secret=${GMAIL_SECRET}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body).toHaveProperty('scanned');
  expect(body).toHaveProperty('archived');
  expect(body).toHaveProperty('errors');
});
