'use strict';
// lib/logger.js
// Structured JSON logger. Every line: { ts, level, msg, ...ctx }.
// Vercel ingests stdout/stderr as-is, so JSON lines stay queryable in the
// Vercel log dashboard and are trivially grep-able by request_id.
//
// The logger is intentionally tiny: no transports, no log levels gate, no
// async sinks. If we need fan-out (Sentry, Datadog), wire it inside the
// individual functions — keep the public surface stable.
//
// Sentry integration: when @sentry/node is installed and the sentry_enabled
// flag is on, log.error also calls Sentry.captureException. Wired in PR 1.

function fmt(level, msg, ctx) {
  const base = { ts: new Date().toISOString(), level };
  if (msg !== undefined) base.msg = msg;
  if (ctx && typeof ctx === 'object') Object.assign(base, ctx);
  return JSON.stringify(base);
}

function info(msg, ctx) {
  console.log(fmt('info', msg, ctx));
}

function warn(msg, ctx) {
  console.warn(fmt('warn', msg, ctx));
}

function error(errOrMsg, ctx) {
  let payload;
  if (errOrMsg instanceof Error) {
    payload = fmt('error', errOrMsg.message, {
      ...(ctx || {}),
      stack: errOrMsg.stack,
      name: errOrMsg.name,
    });
  } else {
    payload = fmt('error', errOrMsg, ctx);
  }
  console.error(payload);

  // Soft Sentry integration — wired in PR 1 (sentry_enabled flag).
  // We avoid require() at module load to keep the logger zero-dep.
  try {
    const { captureException } = require('../api/_lib/sentry.js');
    if (typeof captureException === 'function') {
      captureException(errOrMsg, ctx);
    }
  } catch {
    // Sentry not installed yet — fine, fall through.
  }
}

// Returns a child logger that injects ctx into every line.
// Use in request handlers: const reqLog = log.child({ request_id, route });
function child(boundCtx) {
  return {
    info: (msg, ctx) => info(msg, { ...boundCtx, ...(ctx || {}) }),
    warn: (msg, ctx) => warn(msg, { ...boundCtx, ...(ctx || {}) }),
    error: (e, ctx) => error(e, { ...boundCtx, ...(ctx || {}) }),
    child: (extra) => child({ ...boundCtx, ...(extra || {}) }),
  };
}

const log = { info, warn, error, child, _fmt: fmt };

module.exports = { log };
