// @ts-check
// Regression test for tests/helpers/flags.js — verifies the helper
// soft-skips on Upstash quota 500 and throws on every other failure mode.
//
// Run alone:  npx playwright test tests/journey/quota-aware-skip.spec.js
//
// Strategy: stub the Playwright APIRequestContext with a tiny fake that
// returns the response we want. setFlagOrSkip only relies on .post(),
// .ok(), .status(), .text(), .json() — all covered below. No network.
//
// The "soft-skip" test confirms behavior by having a body that THROWS
// after the helper call. If the helper correctly calls test.skip(), the
// throw never executes and the test reports as skipped. If a future
// change breaks the skip path, execution continues, the throw fires,
// and the test reports as FAILED. Skip-status counts as passing for the
// suite — exactly what we want in CI.
const { test, expect } = require('@playwright/test');
const { setFlagOrSkip, isQuotaError } = require('../helpers/flags');

function fakeRequest(status, body) {
  return {
    post: async () => ({
      ok: () => status >= 200 && status < 300,
      status: () => status,
      text: async () => body,
      json: async () => {
        try { return JSON.parse(body); } catch { return null; }
      },
    }),
  };
}

const OPTS = { secret: 'sentinel-secret', baseUrl: 'http://example.test' };

test.describe('setFlagOrSkip — quota-aware behavior', () => {
  test('isQuotaError matches the Upstash daily-limit string', () => {
    expect(isQuotaError('ERR max requests limit exceeded')).toBe(true);
    expect(isQuotaError('UPSTASH daily limit reached')).toBe(true);
    expect(isQuotaError('quota exceeded for free tier')).toBe(true);
    expect(isQuotaError('connection reset by peer')).toBe(false);
    expect(isQuotaError('')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  test('returns the response object on 200', async () => {
    const req = fakeRequest(200, JSON.stringify({ ok: true, name: 'x', enabled: true }));
    const res = await setFlagOrSkip(req, 'x', true, OPTS);
    expect(res).toBeDefined();
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('throws on 500 that is NOT a quota error (real bug stays loud)', async () => {
    const req = fakeRequest(500, JSON.stringify({ error: 'database crashed' }));
    let caught;
    try {
      await setFlagOrSkip(req, 'x', true, OPTS);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/500/);
    expect(caught.message).toMatch(/database crashed/);
  });

  test('throws on 401 (auth failures must remain loud)', async () => {
    const req = fakeRequest(401, 'unauthorized');
    let caught;
    try {
      await setFlagOrSkip(req, 'x', true, OPTS);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/401/);
  });

  test('throws when secret is missing (helper-level guard)', async () => {
    const req = fakeRequest(200, '{}');
    let caught;
    try {
      await setFlagOrSkip(req, 'x', true, { secret: '', baseUrl: 'http://example.test' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/secret is required/);
  });

  // ── The critical case ────────────────────────────────────────────────
  // This test should report as SKIPPED in CI. If a future change breaks
  // the skip path, execution falls through to the throw and the test
  // reports as FAILED — surfacing the regression.
  test('soft-skips on Upstash quota 500 (this test should appear as SKIPPED)', async () => {
    const req = fakeRequest(500, 'ERR max requests limit exceeded');
    await setFlagOrSkip(req, 'x', true, OPTS);
    throw new Error(
      'Regression: setFlagOrSkip did not call test.skip() on Upstash quota 500. ' +
      'The whole point of this helper is to skip-not-fail when KV is at quota.',
    );
  });
});
