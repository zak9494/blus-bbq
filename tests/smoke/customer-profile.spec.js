// @ts-check
/**
 * Smoke tests for Group 9 — Customer profile, overdue widget, quote templates, weekly digest.
 * Tests endpoint contracts without UI — using request API only.
 * Run against the Vercel preview URL:
 *   SMOKE_BASE_URL=https://<preview>.vercel.app npx playwright test tests/smoke/customer-profile.spec.js
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.SMOKE_GMAIL_SECRET || '';

// ── /api/customer/profile ───────────────────────────────────────────────────

test('GET /api/customer/profile → 401 without secret', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/customer/profile?email=test@example.com`);
  expect(res.status()).toBe(401);
});

test('GET /api/customer/profile → 400 without email', async ({ request }) => {
  test.skip(!SECRET, 'Requires SMOKE_GMAIL_SECRET');
  const res = await request.get(`${BASE_URL}/api/customer/profile?secret=${SECRET}`);
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

// ── /api/customer/notes ─────────────────────────────────────────────────────

test('GET /api/customer/notes → 401 without secret', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/customer/notes?email=test@example.com`);
  expect(res.status()).toBe(401);
});

// ── /api/pipeline/overdue ───────────────────────────────────────────────────

test('GET /api/pipeline/overdue → 401 without secret', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/pipeline/overdue`);
  expect(res.status()).toBe(401);
});

// ── /api/quotes/templates ───────────────────────────────────────────────────

test('GET /api/quotes/templates → 401 without secret', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/quotes/templates`);
  expect(res.status()).toBe(401);
});

test('DELETE /api/quotes/templates/nonexistent → 401 without secret', async ({ request }) => {
  const res = await request.delete(`${BASE_URL}/api/quotes/templates/nonexistent`);
  expect(res.status()).toBe(401);
});

// ── /api/quotes/duplicate ───────────────────────────────────────────────────

test('POST /api/quotes/duplicate → 401 without secret', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/quotes/duplicate`, {
    data: { threadId: 'test-thread' },
  });
  expect(res.status()).toBe(401);
});

// ── /api/cron/weekly-digest ─────────────────────────────────────────────────

test('GET /api/cron/weekly-digest → 401 without cron secret', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/cron/weekly-digest`);
  // No auth → 401 or 403 (not 500, not 200)
  expect([401, 403]).toContain(res.status());
});

// ── Feature flags include Group 9 flags ─────────────────────────────────────
//
// These tests assert the flag is present in the seed list and has a boolean
// enabled field. They INTENTIONALLY do not assert the enabled value — Zach
// flips these in prod KV and the seed default may diverge, so pinning to a
// specific value puts CI hostage to prod state (the same drift class that
// killed PR #122). UI behavior gated on each flag is verified separately
// using mockFlagState() in the spec for that feature.

test('GET /api/flags includes customer_profile_v2 flag', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/flags`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const flag = (body.flags || []).find(f => f.name === 'customer_profile_v2');
  expect(flag).toBeTruthy();
  expect(typeof flag.enabled).toBe('boolean');
});

test('GET /api/flags includes quote_templates flag', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/flags`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const flag = (body.flags || []).find(f => f.name === 'quote_templates');
  expect(flag).toBeTruthy();
  expect(typeof flag.enabled).toBe('boolean');
});

test('GET /api/flags includes overdue_widget flag', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/flags`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const flag = (body.flags || []).find(f => f.name === 'overdue_widget');
  expect(flag).toBeTruthy();
  expect(typeof flag.enabled).toBe('boolean');
});

test('GET /api/flags includes weekly_digest flag', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/flags`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const flag = (body.flags || []).find(f => f.name === 'weekly_digest');
  expect(flag).toBeTruthy();
  expect(typeof flag.enabled).toBe('boolean');
});
