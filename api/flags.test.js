'use strict';
// Unit tests for api/flags.js handler validation (no KV calls).
// Tests exercise the auth + input guards that run before any KV write.
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

// Stub _lib/flags.js so handler never touches KV.
const flagsLib = { getFlag: async () => false, setFlag: async () => ({ enabled: false, description: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }), listFlags: async () => [] };
require.cache[require.resolve('./_lib/flags.js')] = { id: require.resolve('./_lib/flags.js'), filename: require.resolve('./_lib/flags.js'), loaded: true, exports: flagsLib };

const handler = require('./flags.js');

function makeReq(method, url, body = {}) {
  return { method, url, body };
}
function makeRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = () => res;
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  res.end = () => res;
  return res;
}

const SECRET = 'test-secret-123';

describe('api/flags.js — auth guard', () => {
  it('POST without secret → 401', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/kanban_restructure', { secret: 'wrong', enabled: true }), res);
    assert.equal(res._status, 401);
  });

  it('POST with correct secret passes auth', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/kanban_restructure', { secret: SECRET, enabled: false }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
  });
});

describe('api/flags.js — flag name validation', () => {
  it('name with uppercase letters → 400', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/Bad_Name', { secret: SECRET, enabled: true }), res);
    assert.equal(res._status, 400);
  });

  it('name with hyphen → 400', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/bad-name', { secret: SECRET, enabled: true }), res);
    assert.equal(res._status, 400);
  });

  it('valid seed name kanban_restructure → 200', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/kanban_restructure', { secret: SECRET, enabled: false }), res);
    assert.equal(res._status, 200);
  });
});

describe('api/flags.js — body.enabled validation', () => {
  it('missing body.enabled → 400', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/kanban_restructure', { secret: SECRET }), res);
    assert.equal(res._status, 400);
  });

  it('body.enabled as string → 400', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/kanban_restructure', { secret: SECRET, enabled: 'true' }), res);
    assert.equal(res._status, 400);
  });

  it('body.enabled=true → 200', async () => {
    process.env.SELF_MODIFY_SECRET = SECRET;
    const res = makeRes();
    await handler(makeReq('POST', '/api/flags/kanban_restructure', { secret: SECRET, enabled: true }), res);
    assert.equal(res._status, 200);
  });
});
