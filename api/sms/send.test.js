'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal HTTP response/request mock ─────────────────────────────────────
function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body = b;  return res; };
  res.end    = ()  => res;
  return res;
}

function makeReq(body = {}, query = {}, headers = {}) {
  return { method: 'POST', body, query, headers };
}

// ── Stub out getFlag before requiring send.js ────────────────────────────────
// Node's require cache means we need to patch the module registry.
// We do it by overwriting require in the module's context via a thin wrapper.
let flagValue = true;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../_lib/flags' && parent && parent.filename && parent.filename.includes('api/sms/send')) {
    return { getFlag: async () => flagValue };
  }
  return origLoad.apply(this, arguments);
};

// Now require send.js (the patched getFlag will be used)
const path = require('path');
const sendHandler = require(path.join(__dirname, 'send.js'));

// Restore original _load after module is cached
Module._load = origLoad;

// ── Helpers to manipulate env vars safely ────────────────────────────────────
const ENV_KEYS = ['GMAIL_READ_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
let savedEnv = {};
beforeEach(() => { savedEnv = {}; ENV_KEYS.forEach(k => { savedEnv[k] = process.env[k]; delete process.env[k]; }); });
afterEach(() => { ENV_KEYS.forEach(k => { if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k]; else delete process.env[k]; }); });

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('sms/send — method guard', () => {
  it('returns 405 for GET', async () => {
    const req = { method: 'GET', body: {}, query: {}, headers: {} };
    const res = makeRes();
    await sendHandler(req, res);
    assert.equal(res._status, 405);
  });
});

describe('sms/send — secret gate', () => {
  it('returns 500 when GMAIL_READ_SECRET not set', async () => {
    const res = makeRes();
    await sendHandler(makeReq(), res);
    assert.equal(res._status, 500);
    assert.match(res._body.error, /GMAIL_READ_SECRET/);
  });

  it('returns 401 when wrong secret supplied', async () => {
    process.env.GMAIL_READ_SECRET = 'correctsecret';
    const res = makeRes();
    await sendHandler(makeReq({}, { secret: 'wrong' }), res);
    assert.equal(res._status, 401);
  });

  it('returns 401 when no secret supplied', async () => {
    process.env.GMAIL_READ_SECRET = 'correctsecret';
    const res = makeRes();
    await sendHandler(makeReq(), res);
    assert.equal(res._status, 401);
  });
});

describe('sms/send — flag gate', () => {
  it('returns 403 when sms_channel flag is OFF', async () => {
    process.env.GMAIL_READ_SECRET = 'sec';
    flagValue = false;
    const res = makeRes();
    await sendHandler(makeReq({}, { secret: 'sec' }), res);
    assert.equal(res._status, 403);
    assert.match(res._body.error, /sms_channel/);
    flagValue = true;
  });
});

describe('sms/send — input validation', () => {
  beforeEach(() => { process.env.GMAIL_READ_SECRET = 'sec'; flagValue = true; });

  it('returns 400 when to is missing', async () => {
    const res = makeRes();
    await sendHandler(makeReq({ body: 'Hello' }, { secret: 'sec' }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /required/);
  });

  it('returns 400 when body is missing', async () => {
    const res = makeRes();
    await sendHandler(makeReq({ to: '+12145550000' }, { secret: 'sec' }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /required/);
  });

  it('returns 400 for non-E.164 number', async () => {
    const res = makeRes();
    await sendHandler(makeReq({ to: '2145550000', body: 'Hi' }, { secret: 'sec' }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /E\.164/);
  });

  it('returns 400 for number with wrong country code', async () => {
    const res = makeRes();
    await sendHandler(makeReq({ to: '+442071234567', body: 'Hi' }, { secret: 'sec' }), res);
    assert.equal(res._status, 400);
  });
});

describe('sms/send — stub mode (Twilio env vars absent)', () => {
  beforeEach(() => { process.env.GMAIL_READ_SECRET = 'sec'; flagValue = true; });

  it('returns ok=true with mode=stub when Twilio vars not set', async () => {
    const res = makeRes();
    await sendHandler(makeReq({ to: '+12145550000', body: 'Test message' }, { secret: 'sec' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.mode, 'stub');
    assert.equal(res._body.to, '+12145550000');
    assert.ok(res._body.ts);
  });

  it('stub mode includes ts ISO string', async () => {
    const res = makeRes();
    await sendHandler(makeReq({ to: '+12145550000', body: 'Hi' }, { secret: 'sec' }), res);
    assert.ok(new Date(res._body.ts).getTime() > 0);
  });
});
