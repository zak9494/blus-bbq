'use strict';
// api/_middleware/request-id.js
// Per-request UUID + structured-log helper for Vercel serverless handlers.
//
// Vercel does not have an Express-style middleware chain, so handlers wrap
// themselves in `withRequestId(handler)`:
//
//   const { withRequestId } = require('../_middleware/request-id');
//   module.exports = withRequestId(async (req, res, ctx) => {
//     ctx.log.info('processing', { user_id });
//     ...
//   });
//
// `ctx.log` is a child logger pre-bound with { request_id, route, method }.
// `ctx.request_id` is also available for echoing back to clients.

const crypto = require('crypto');
const { log } = require('../../lib/logger');

const HEADER = 'x-request-id';

function newRequestId() {
  // crypto.randomUUID is available in Node 14.17+/16+; Vercel runs 18+.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback — should not run on Vercel, present for older Node test envs.
  return crypto.randomBytes(16).toString('hex');
}

function withRequestId(handler) {
  return async function wrapped(req, res) {
    const incoming = (req.headers && req.headers[HEADER]) || null;
    const request_id = incoming || newRequestId();
    const route = (req.url || '').split('?')[0];
    const method = req.method || 'GET';

    if (res && typeof res.setHeader === 'function') {
      res.setHeader(HEADER, request_id);
    }

    const reqLog = log.child({ request_id, route, method });
    const ctx = { request_id, log: reqLog };

    const start = Date.now();
    try {
      const out = await handler(req, res, ctx);
      reqLog.info('request_complete', {
        status: res && res.statusCode,
        duration_ms: Date.now() - start,
      });
      return out;
    } catch (err) {
      reqLog.error(err, { duration_ms: Date.now() - start });
      throw err;
    }
  };
}

module.exports = { withRequestId, newRequestId, HEADER };
