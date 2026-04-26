'use strict';

// api/_lib/sentry.test.js
// Hermetic unit tests for the Sentry wrapper. We never load the real
// @sentry/node package — initSentry() short-circuits when SENTRY_DSN is
// unset OR when the sentry_enabled flag is off, which is the only path
// the unit tests should exercise.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sentryPath = require.resolve('./sentry');
const flagsPath = require.resolve('./flags');

function freshSentry({ dsn, flagEnabled }) {
  // Force module re-eval with a clean cache so init state resets.
  delete require.cache[sentryPath];
  delete require.cache[flagsPath];

  if (dsn === null) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = dsn;

  // Stub the flags module so we don't need a live KV.
  require.cache[flagsPath] = {
    id: flagsPath,
    filename: flagsPath,
    loaded: true,
    exports: {
      getFlag: async (name, def) => (name === 'sentry_enabled' ? flagEnabled : def),
      SEED_FLAGS: [{ name: 'sentry_enabled' }],
    },
  };

  return require('./sentry');
}

test('initSentry returns null when DSN is unset', async () => {
  const sentry = freshSentry({ dsn: null, flagEnabled: true });
  const out = await sentry.initSentry();
  assert.equal(out, null);
});

test('initSentry returns null when flag is off (even with DSN set)', async () => {
  const sentry = freshSentry({ dsn: 'https://abc@sentry.io/123', flagEnabled: false });
  const out = await sentry.initSentry();
  assert.equal(out, null);
});

test('captureException is a safe no-op before init', () => {
  const sentry = freshSentry({ dsn: null, flagEnabled: false });
  // Must not throw even though Sentry was never loaded.
  sentry.captureException(new Error('boom'), { route: '/x' });
});

test('withSentry rethrows handler errors and never breaks request flow', async () => {
  const sentry = freshSentry({ dsn: null, flagEnabled: false });
  const wrapped = sentry.withSentry(async () => {
    throw new TypeError('handler boom');
  });
  let caught = null;
  try {
    await wrapped({ headers: {}, url: '/api/x', method: 'GET' }, {});
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof TypeError);
  assert.equal(caught.message, 'handler boom');
});

test('release() prefers VERCEL_GIT_COMMIT_SHA when set', () => {
  const sentry = freshSentry({ dsn: null, flagEnabled: false });
  process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
  assert.equal(sentry._internals.release(), 'abc123');
  delete process.env.VERCEL_GIT_COMMIT_SHA;
});

test('environment() reads VERCEL_ENV', () => {
  const sentry = freshSentry({ dsn: null, flagEnabled: false });
  process.env.VERCEL_ENV = 'preview';
  assert.equal(sentry._internals.environment(), 'preview');
  process.env.VERCEL_ENV = 'production';
  assert.equal(sentry._internals.environment(), 'production');
  delete process.env.VERCEL_ENV;
});

test('sentry-config endpoint returns enabled:false when DSN is unset', async () => {
  delete process.env.SENTRY_DSN;
  // Stub flags
  delete require.cache[flagsPath];
  require.cache[flagsPath] = {
    id: flagsPath,
    filename: flagsPath,
    loaded: true,
    exports: {
      getFlag: async () => true,
      SEED_FLAGS: [],
    },
  };
  const handlerPath = require.resolve(path.join(__dirname, '..', 'sentry-config'));
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  let body = '';
  let status = 0;
  const res = {
    setHeader: () => {},
    end: (s) => {
      body = s;
    },
    get statusCode() {
      return status;
    },
    set statusCode(v) {
      status = v;
    },
  };
  await handler({ url: '/api/sentry-config' }, res);
  const out = JSON.parse(body);
  assert.equal(out.enabled, false);
  assert.equal(status, 200);
});
