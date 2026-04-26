'use strict';
// api/_lib/sentry.js
// Server-side Sentry wrapper. Flag-gated, env-gated, lazy-loaded so
// SENTRY_DSN absence is a clean no-op (no broken require, no crashes).
//
// Wire-up pattern:
//   const { initSentry, captureException, withSentry } = require('../_lib/sentry');
//   await initSentry();                       // top of route file (idempotent)
//   module.exports = withSentry(handler);     // wraps handler so unhandled errors flow to Sentry
//
// `initSentry()` returns a Promise that resolves when init is complete (or
// skipped). It is safe to await on every request — internal flag read is
// cached for 60 seconds.

let initialized = false;
let initPromise = null;
let SentryRef = null;

let cachedFlag = null;
let cachedFlagAt = 0;
const FLAG_TTL_MS = 60_000;

async function flagEnabled() {
  const now = Date.now();
  if (cachedFlag !== null && now - cachedFlagAt < FLAG_TTL_MS) {
    return cachedFlag;
  }
  try {
    const { getFlag } = require('./flags');
    cachedFlag = await getFlag('sentry_enabled', false);
  } catch {
    cachedFlag = false;
  }
  cachedFlagAt = now;
  return cachedFlag;
}

function dsn() {
  return process.env.SENTRY_DSN || null;
}

function release() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.npm_package_version ||
    'unknown'
  );
}

function environment() {
  if (process.env.VERCEL_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview') return 'preview';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

async function initSentry() {
  if (initialized) return SentryRef;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const ok = dsn() && (await flagEnabled());
    if (!ok) {
      initialized = true; // remember "no" to avoid retry storms
      return null;
    }

    let Sentry;
    try {
      Sentry = require('@sentry/node');
    } catch {
      // Module not installed; behave as no-op.
      initialized = true;
      return null;
    }

    Sentry.init({
      dsn: dsn(),
      release: release(),
      environment: environment(),
      tracesSampleRate: 0,
      // Avoid capturing PII by default — handlers must opt in.
      sendDefaultPii: false,
    });
    SentryRef = Sentry;
    initialized = true;
    return Sentry;
  })();

  return initPromise;
}

function captureException(err, ctx) {
  if (!SentryRef) return;
  try {
    SentryRef.withScope((scope) => {
      if (ctx && typeof ctx === 'object') {
        for (const [k, v] of Object.entries(ctx)) {
          scope.setExtra(k, v);
        }
        if (ctx.request_id) scope.setTag('request_id', ctx.request_id);
        if (ctx.route) scope.setTag('route', ctx.route);
      }
      if (err instanceof Error) {
        SentryRef.captureException(err);
      } else {
        SentryRef.captureMessage(String(err));
      }
    });
  } catch {
    // Never let Sentry failures break a request.
  }
}

function withSentry(handler) {
  return async function wrapped(req, res, ...rest) {
    await initSentry();
    try {
      return await handler(req, res, ...rest);
    } catch (err) {
      captureException(err, {
        request_id: (req && req.headers && req.headers['x-request-id']) || null,
        route: req && req.url,
        method: req && req.method,
      });
      throw err;
    }
  };
}

// Test hook — clears state between unit tests.
function _resetForTests() {
  initialized = false;
  initPromise = null;
  SentryRef = null;
  cachedFlag = null;
  cachedFlagAt = 0;
}

module.exports = {
  initSentry,
  captureException,
  withSentry,
  _internals: { dsn, release, environment, flagEnabled },
  _resetForTests,
};
