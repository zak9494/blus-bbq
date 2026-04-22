'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── test-mode.js runs as a browser IIFE and relies on window globals.
// We shim the minimum required to exercise the exported functions.
global.window = global.window || {};
global.window.showTestData = false;
global.window.flags = { isEnabled: () => false };
// Suppress DOM calls in renderTestControls / showToast
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  createElement: () => ({ style: {}, textContent: '', remove() {} }),
  body: { appendChild() {} },
};

// Load the module — it registers window.testMode
require('./test-mode.js');

const { isTestInquiry, shouldShowInquiry } = global.window.testMode;

// ── isTestInquiry ─────────────────────────────────────────────────────────────
describe('isTestInquiry', () => {
  it('returns true when test=true', () => {
    assert.ok(isTestInquiry({ threadId: 'abc123', test: true }));
  });

  it('returns true when threadId starts with test-', () => {
    assert.ok(isTestInquiry({ threadId: 'test-1234567890' }));
  });

  it('returns false for a real inquiry', () => {
    assert.ok(!isTestInquiry({ threadId: '18f4ab12cd', test: false }));
  });

  it('returns false when test=false and threadId is normal', () => {
    assert.ok(!isTestInquiry({ threadId: 'thread-abc', test: false }));
  });

  it('returns false for null', () => {
    assert.ok(!isTestInquiry(null));
  });

  it('returns false for empty object', () => {
    assert.ok(!isTestInquiry({}));
  });

  it('does not false-positive on threadId containing "test" mid-string', () => {
    assert.ok(!isTestInquiry({ threadId: 'protest-123', test: false }));
  });
});

// ── shouldShowInquiry ─────────────────────────────────────────────────────────
describe('shouldShowInquiry', () => {
  it('real inquiry always shown', () => {
    global.window.showTestData = false;
    assert.ok(shouldShowInquiry({ threadId: 'real-thread', test: false }));
  });

  it('test inquiry hidden when showTestData=false', () => {
    global.window.showTestData = false;
    assert.ok(!shouldShowInquiry({ threadId: 'test-123', test: true }));
  });

  it('test inquiry visible when showTestData=true', () => {
    global.window.showTestData = true;
    assert.ok(shouldShowInquiry({ threadId: 'test-123', test: true }));
  });

  it('test- prefix inquiry hidden when showTestData=false', () => {
    global.window.showTestData = false;
    assert.ok(!shouldShowInquiry({ threadId: 'test-9999', test: false }));
  });

  it('test- prefix inquiry visible when showTestData=true', () => {
    global.window.showTestData = true;
    assert.ok(shouldShowInquiry({ threadId: 'test-9999', test: false }));
  });
});

// ── resolveRecipient (dispatch/email.js) ──────────────────────────────────────
// resolveRecipient is now async — it reads the configured test email from KV.
// This describe block installs its own KV mock so tests run without Upstash.
describe('resolveRecipient', () => {
  const _rrStore = {};
  process.env.KV_REST_API_URL   = process.env.KV_REST_API_URL   || 'https://mock-kv.example.com';
  process.env.KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || 'mock-token';
  const _https = require('https');
  _https.request = function(opts, cb) {
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
            const val = Object.prototype.hasOwnProperty.call(_rrStore, key) ? _rrStore[key] : null;
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
              if (cmd[0] === 'SET') _rrStore[cmd[1]] = cmd[2];
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
  };

  const { resolveRecipient } = require('../../api/dispatch/email.js');

  it('returns original to for a normal inquiry', async () => {
    _rrStore['settings:test_mode_email'] = 'dev@example.com';
    const to = await resolveRecipient('customer@example.com', { inquiry: { test: false, threadId: 'real-abc' } });
    assert.equal(to, 'customer@example.com');
  });

  it('redirects to configured email when inquiry.test=true', async () => {
    _rrStore['settings:test_mode_email'] = 'dev@example.com';
    const to = await resolveRecipient('customer@example.com', { inquiry: { test: true, threadId: 'test-123' } });
    assert.equal(to, 'dev@example.com');
  });

  it('redirects when testOverride=true regardless of inquiry', async () => {
    _rrStore['settings:test_mode_email'] = 'dev@example.com';
    const to = await resolveRecipient('customer@example.com', { testOverride: true, inquiry: { test: false } });
    assert.equal(to, 'dev@example.com');
  });

  it('redirects when threadId starts with test- even if test field absent', async () => {
    _rrStore['settings:test_mode_email'] = 'dev@example.com';
    const to = await resolveRecipient('customer@example.com', { inquiry: { threadId: 'test-999' } });
    assert.equal(to, 'dev@example.com');
  });

  it('throws when test inquiry and no email configured', async () => {
    delete _rrStore['settings:test_mode_email'];
    await assert.rejects(
      () => resolveRecipient('customer@example.com', { inquiry: { test: true } }),
      (err) => {
        assert.ok(err.message.includes('Test mode email target not configured'));
        return true;
      }
    );
  });

  it('returns to unchanged when no context provided', async () => {
    const to = await resolveRecipient('someone@example.com', {});
    assert.equal(to, 'someone@example.com');
  });
});
