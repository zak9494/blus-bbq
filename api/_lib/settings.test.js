'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
process.env.KV_REST_API_TOKEN = 'mock-token';

// ── KV mock ───────────────────────────────────────────────────────────────────
const https = require('https');

const _store = {};

function mockRequest(opts, cb) {
  const path   = typeof opts === 'string' ? opts : (opts.path || '');
  const method = (typeof opts === 'object' && opts.method) ? opts.method : 'GET';

  const bodyChunks = [];
  const res = {
    statusCode: 200,
    on(event, handler) {
      if (event === 'data') res._dataHandler = handler;
      if (event === 'end')  res._endHandler  = handler;
      return res;
    },
    resume() { return res; },
  };

  const req = {
    write(chunk) { bodyChunks.push(chunk); },
    end() {
      let responseBody;
      if (method === 'GET') {
        const m = path.match(/\/get\/([^?]+)/);
        if (m) {
          const key = decodeURIComponent(m[1]);
          const val = Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null;
          responseBody = JSON.stringify({ result: val });
        } else {
          responseBody = JSON.stringify({ result: null });
        }
      } else {
        const raw = bodyChunks.join('');
        let cmds = [];
        try { cmds = JSON.parse(raw); } catch { cmds = []; }
        if (Array.isArray(cmds) && Array.isArray(cmds[0])) {
          cmds.forEach(function(cmd) {
            if (cmd[0] === 'SET') _store[cmd[1]] = cmd[2];
          });
        }
        responseBody = JSON.stringify([{ result: 'OK' }]);
      }

      if (cb) cb(res);
      if (res._dataHandler) res._dataHandler(responseBody);
      if (res._endHandler)  res._endHandler();
    },
    on() { return req; },
  };
  return req;
}

https.request = mockRequest;

// Load modules under test after mock is installed
const { getTestModeEmail, setTestModeEmail } = require('./settings.js');
const { resolveRecipient } = require('../dispatch/email.js');

function clearStore() {
  Object.keys(_store).forEach(k => delete _store[k]);
}

// ── getTestModeEmail ──────────────────────────────────────────────────────────

describe('getTestModeEmail', () => {
  it('returns null when key is absent', async () => {
    clearStore();
    const result = await getTestModeEmail();
    assert.equal(result, null);
  });

  it('returns null when key is empty string', async () => {
    clearStore();
    _store['settings:test_mode_email'] = '';
    const result = await getTestModeEmail();
    assert.equal(result, null);
  });

  it('returns the stored email string when set', async () => {
    clearStore();
    await setTestModeEmail('test@example.com');
    const result = await getTestModeEmail();
    assert.equal(result, 'test@example.com');
  });

  it('trims whitespace from stored value', async () => {
    clearStore();
    _store['settings:test_mode_email'] = '  padded@example.com  ';
    const result = await getTestModeEmail();
    assert.equal(result, 'padded@example.com');
  });
});

describe('setTestModeEmail', () => {
  it('persists so getTestModeEmail reads back the value', async () => {
    clearStore();
    await setTestModeEmail('saved@example.com');
    const result = await getTestModeEmail();
    assert.equal(result, 'saved@example.com');
  });

  it('clears the value when called with empty string', async () => {
    clearStore();
    await setTestModeEmail('first@example.com');
    await setTestModeEmail('');
    const result = await getTestModeEmail();
    assert.equal(result, null);
  });
});

// ── resolveRecipient ──────────────────────────────────────────────────────────

describe('resolveRecipient', () => {
  before(clearStore);

  it('returns original to for non-test inquiry, regardless of setting', async () => {
    clearStore();
    await setTestModeEmail('test@example.com');
    const result = await resolveRecipient('customer@example.com', { inquiry: { test: false } });
    assert.equal(result, 'customer@example.com');
  });

  it('returns original to for inquiry with no test flag and normal threadId', async () => {
    clearStore();
    const result = await resolveRecipient('customer@example.com', { inquiry: { threadId: 'real-thread-123' } });
    assert.equal(result, 'customer@example.com');
  });

  it('returns setting value when inquiry.test=true and setting is configured', async () => {
    clearStore();
    await setTestModeEmail('dev@example.com');
    const result = await resolveRecipient('customer@example.com', { inquiry: { test: true } });
    assert.equal(result, 'dev@example.com');
  });

  it('returns setting value when threadId starts with test- and setting is configured', async () => {
    clearStore();
    await setTestModeEmail('dev@example.com');
    const result = await resolveRecipient('customer@example.com', { inquiry: { threadId: 'test-abc123' } });
    assert.equal(result, 'dev@example.com');
  });

  it('returns setting value when testOverride=true and setting is configured', async () => {
    clearStore();
    await setTestModeEmail('dev@example.com');
    const result = await resolveRecipient('customer@example.com', { inquiry: {}, testOverride: true });
    assert.equal(result, 'dev@example.com');
  });

  it('throws specific error when inquiry is test but setting is unset', async () => {
    clearStore();
    await assert.rejects(
      () => resolveRecipient('customer@example.com', { inquiry: { test: true } }),
      (err) => {
        assert.ok(err.message.includes('Test mode email target not configured'));
        return true;
      }
    );
  });

  it('throws when threadId starts with test- and setting is unset', async () => {
    clearStore();
    await assert.rejects(
      () => resolveRecipient('customer@example.com', { inquiry: { threadId: 'test-xyz' } }),
      (err) => {
        assert.ok(err.message.includes('Test mode email target not configured'));
        return true;
      }
    );
  });
});
