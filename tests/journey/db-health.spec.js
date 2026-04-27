// @ts-check
// Journey test — Postgres health endpoint
//
// Phase 1 of the Postgres migration ships /api/db/health behind the same
// INQ_SECRET / SELF_MODIFY_SECRET gate as other diag endpoints. This
// spec verifies:
//   1. Without auth → 401
//   2. With auth → 200 with a JSON body containing `ok` and `phase`
//
// We do NOT assert ok === true. POSTGRES_URL may not be configured yet
// in the preview environment (this is expected during Phase 1). The
// endpoint must still respond cleanly with ok === false in that case —
// that path IS tested here.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.INQ_SECRET || process.env.SELF_MODIFY_SECRET || '';

test.describe('db health endpoint', () => {
  test('without secret → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/db/health`);
    expect(res.status()).toBe(401);
  });

  test('with secret → 200 with structured body', async ({ request }) => {
    test.skip(!SECRET, 'INQ_SECRET / SELF_MODIFY_SECRET not set in this environment');
    const res = await request.get(`${BASE_URL}/api/db/health?secret=${encodeURIComponent(SECRET)}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('ok');
    expect(typeof body.ok).toBe('boolean');
    expect(body).toHaveProperty('phase');
    expect(body.phase).toBe('phase-1-scaffolding');

    if (body.ok === false) {
      // Either env var is unset or connection failed — both are valid Phase 1
      // states. The body should explain which.
      expect(typeof body.status).toBe('string');
    } else {
      // ok === true → connection live; alive must be true.
      expect(body.alive).toBe(true);
    }
  });
});
