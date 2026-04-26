// @ts-check
// Journey tests — /api/self-modify authentication gate
// Verifies that the endpoint rejects unauthenticated requests and accepts a valid secret.
const { test, expect, request } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET = process.env.SELF_MODIFY_SECRET || '';

test.describe('/api/self-modify auth gate', () => {
  test('no secret → 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const resp = await ctx.get('/api/self-modify');
    expect(resp.status()).toBe(401);
    await ctx.dispose();
  });

  test('wrong secret → 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const resp = await ctx.get('/api/self-modify?secret=definitely-not-the-right-secret');
    expect(resp.status()).toBe(401);
    await ctx.dispose();
  });

  test('correct secret → not 401', async () => {
    if (!SECRET) {
      test.skip(true, 'SELF_MODIFY_SECRET not set in test environment — skipping auth success case');
      return;
    }
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const resp = await ctx.get(`/api/self-modify?secret=${encodeURIComponent(SECRET)}`);
    expect(resp.status()).not.toBe(401);
    await ctx.dispose();
  });
});
