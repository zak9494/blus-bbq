'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');

// ── Fake JWT builder ──────────────────────────────────────────────────────────
function makeIdToken(email) {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ email, sub: 'fake-sub' })).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

// ── https.request mock ────────────────────────────────────────────────────────
let _mockTokenResponse = null;
let _origRequest;

function installHttpsMock() {
  _origRequest = https.request;
  https.request = (opts, cb) => {
    const chunks = [];
    const fakeRes = {
      statusCode: 200,
      on(ev, h) { if (ev === 'data') fakeRes._data = h; if (ev === 'end') fakeRes._end = h; return fakeRes; },
    };
    const fakeReq = {
      write() {},
      end() {
        const hostname = typeof opts === 'string' ? '' : (opts.hostname || '');
        let body;
        if (hostname.includes('oauth2.googleapis.com')) {
          body = JSON.stringify(_mockTokenResponse);
        } else {
          // KV pipeline — always succeed
          body = JSON.stringify([{ result: 'OK' }]);
        }
        if (cb) cb(fakeRes);
        if (fakeRes._data) fakeRes._data(body);
        if (fakeRes._end)  fakeRes._end();
      },
      on() { return fakeReq; },
    };
    return fakeReq;
  };
}

function uninstallHttpsMock() { https.request = _origRequest; }

function loadHandler() {
  delete require.cache[require.resolve('./callback')];
  delete require.cache[require.resolve('../_lib/allowed-accounts')];
  return require('./callback');
}

// ── Mock req/res helpers ──────────────────────────────────────────────────────
function makeReq(query = {}) { return { query }; }
function makeRes() {
  const res = { _redirected: null, _status: null };
  res.redirect = (url) => { res._redirected = url; return res; };
  res.status   = (code) => { res._status = code; return res; };
  res.send     = (msg) => { res._body = msg; return res; };
  res.json     = (obj) => { res._json = obj; return res; };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('auth/callback - account gate', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.ALLOWED_GMAIL_ACCOUNTS;
    delete process.env.ALLOWED_GMAIL_ACCOUNTS;
    process.env.GMAIL_CLIENT_ID     = 'fake-client-id';
    process.env.GMAIL_CLIENT_SECRET = 'fake-secret';
    process.env.KV_REST_API_URL     = 'https://mock-kv.example.com';
    process.env.KV_REST_API_TOKEN   = 'mock-token';
    installHttpsMock();
  });

  afterEach(() => {
    uninstallHttpsMock();
    if (savedEnv === undefined) delete process.env.ALLOWED_GMAIL_ACCOUNTS;
    else process.env.ALLOWED_GMAIL_ACCOUNTS = savedEnv;
  });

  it('redirects with success when the authed email is in the allowlist (default)', async () => {
    _mockTokenResponse = {
      access_token:  'tok-abc',
      refresh_token: 'ref-abc',
      expires_in:    3600,
      scope:         'email openid',
      token_type:    'Bearer',
      id_token:      makeIdToken('info@blusbarbeque.com'),
    };
    const handler = loadHandler();
    const req = makeReq({ code: 'fake-code' });
    const res = makeRes();
    await handler(req, res);
    assert.ok(res._redirected, 'should redirect');
    assert.ok(res._redirected.includes('gmailConnected=1'), `expected success redirect, got: ${res._redirected}`);
    assert.ok(res._redirected.includes(encodeURIComponent('info@blusbarbeque.com')));
  });

  it('redirects with gmailError when email is not in the allowlist', async () => {
    _mockTokenResponse = {
      access_token: 'tok-xyz',
      expires_in:   3600,
      scope:        'email openid',
      token_type:   'Bearer',
      id_token:     makeIdToken('attacker@evil.com'),
    };
    const handler = loadHandler();
    const req = makeReq({ code: 'fake-code' });
    const res = makeRes();
    await handler(req, res);
    assert.ok(res._redirected, 'should redirect');
    assert.ok(res._redirected.includes('gmailError'), `expected error redirect, got: ${res._redirected}`);
    assert.ok(!res._redirected.includes('gmailConnected'));
  });

  it('accepts a custom allowed account from ALLOWED_GMAIL_ACCOUNTS env', async () => {
    process.env.ALLOWED_GMAIL_ACCOUNTS = 'tenant@newbiz.com';
    _mockTokenResponse = {
      access_token:  'tok-tenant',
      refresh_token: 'ref-tenant',
      expires_in:    3600,
      scope:         'email openid',
      token_type:    'Bearer',
      id_token:      makeIdToken('tenant@newbiz.com'),
    };
    const handler = loadHandler();
    const req = makeReq({ code: 'fake-code' });
    const res = makeRes();
    await handler(req, res);
    assert.ok(res._redirected, 'should redirect');
    assert.ok(res._redirected.includes('gmailConnected=1'), `expected success, got: ${res._redirected}`);
  });

  it('rejects default account when it is not in a custom allowlist', async () => {
    process.env.ALLOWED_GMAIL_ACCOUNTS = 'tenant@newbiz.com';
    _mockTokenResponse = {
      access_token: 'tok-old',
      expires_in:   3600,
      scope:        'email openid',
      token_type:   'Bearer',
      id_token:     makeIdToken('info@blusbarbeque.com'),
    };
    const handler = loadHandler();
    const req = makeReq({ code: 'fake-code' });
    const res = makeRes();
    await handler(req, res);
    assert.ok(res._redirected.includes('gmailError'), `expected error, got: ${res._redirected}`);
  });

  it('redirects with error forwarded from Google when error param is present', async () => {
    const handler = loadHandler();
    const req = makeReq({ error: 'access_denied' });
    const res = makeRes();
    await handler(req, res);
    assert.ok(res._redirected.includes('gmailError=access_denied'));
  });
});
