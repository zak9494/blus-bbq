// @ts-check
// Quota-aware flag helpers for Playwright specs.
//
// Background: api/_lib/flags.js was hardened (PR #105) so KV write failures
// surface as HTTP 500 with the underlying error in the body, instead of being
// swallowed as a fake 200. That fix is correct, but it makes the entire smoke
// suite hostage to Upstash quota — when the daily 500K request limit is hit,
// every spec that does setFlag(...) gets a 500 and downstream assertions time
// out, killing 16+ PRs at once.
//
// Solution: when the flag-write API returns 500 with the Upstash quota error,
// soft-skip the affected test instead of failing it. Other 5xx (real bugs)
// still throw.
//
// Usage from a spec:
//   const { setFlagOrSkip } = require('../helpers/flags');
//   ...
//   test.beforeAll(async ({ request }) => {
//     await setFlagOrSkip(request, 'email_thread_v2', true, { secret, baseUrl });
//   });
//
// Calling test.skip(true, msg) from beforeAll skips the entire describe block;
// from a test body it skips that test only. The helper just calls into
// Playwright's normal skip mechanism — no magic.

const { test } = require('@playwright/test');

const QUOTA_PATTERNS = [
  /max requests limit exceeded/i,
  /quota.*exceed/i,
  /daily.*limit/i,
  /upstash.*limit/i,
];

function isQuotaError(body) {
  if (!body) return false;
  return QUOTA_PATTERNS.some((re) => re.test(body));
}

/**
 * POST /api/flags/<name> with quota-aware skip behavior.
 *
 * - Returns the response object on success (status < 400).
 * - On 500 with the Upstash quota error string, calls test.skip(true, msg).
 * - On any other failure, throws with the status and body for diagnosis.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} name flag name
 * @param {boolean} enabled target state
 * @param {{ secret: string, baseUrl: string, description?: string }} opts
 * @returns {Promise<import('@playwright/test').APIResponse | undefined>}
 */
async function setFlagOrSkip(request, name, enabled, opts) {
  const { secret, baseUrl, description = '' } = opts;
  if (!secret) {
    throw new Error(`setFlagOrSkip(${name}): secret is required`);
  }
  if (!baseUrl) {
    throw new Error(`setFlagOrSkip(${name}): baseUrl is required`);
  }

  const res = await request.post(`${baseUrl}/api/flags/${name}`, {
    data: { secret, enabled, description },
    failOnStatusCode: false,
  });

  if (res.ok()) return res;

  const body = await res.text().catch(() => '');

  if (res.status() === 500 && isQuotaError(body)) {
    test.skip(
      true,
      `Skipping: KV at quota for setFlag(${name}). Will pass on next reset. ` +
        `Body: ${body.slice(0, 200)}`,
    );
    return undefined;
  }

  throw new Error(
    `setFlag(${name}, ${enabled}) returned ${res.status()}: ${body.slice(0, 500)}`,
  );
}

module.exports = { setFlagOrSkip, isQuotaError };
