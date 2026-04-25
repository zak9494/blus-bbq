'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
process.env.KV_REST_API_TOKEN = 'mock-token';

const https = require('https');
const _kv    = {};
const _zsets = {};

function clearStore() {
  Object.keys(_kv).forEach(k => delete _kv[k]);
  Object.keys(_zsets).forEach(k => delete _zsets[k]);
}

function execCmd(cmd) {
  const [op, ...args] = cmd;
  switch (op) {
    case 'SET':   _kv[args[0]] = args[1]; return { result: 'OK' };
    case 'GET':   return { result: Object.prototype.hasOwnProperty.call(_kv, args[0]) ? _kv[args[0]] : null };
    case 'DEL':   { const existed = args[0] in _kv; delete _kv[args[0]]; return { result: existed ? 1 : 0 }; }
    case 'INCR':  { const n = parseInt(_kv[args[0]] || '0', 10) + 1; _kv[args[0]] = String(n); return { result: n }; }
    case 'DECR':  { const n = parseInt(_kv[args[0]] || '0', 10) - 1; _kv[args[0]] = String(n); return { result: n }; }
    case 'ZADD':  {
      const [key, score, member] = args;
      if (!_zsets[key]) _zsets[key] = new Map();
      _zsets[key].set(member, Number(score));
      return { result: 1 };
    }
    case 'ZREM':  {
      const [key, member] = args;
      const existed = _zsets[key] && _zsets[key].has(member);
      if (_zsets[key]) _zsets[key].delete(member);
      return { result: existed ? 1 : 0 };
    }
    case 'ZREVRANGE': {
      const [key, start, stop] = args;
      if (!_zsets[key]) return { result: [] };
      const sorted = [..._zsets[key].entries()]
        .sort((a, b) => b[1] - a[1]).map(([m]) => m);
      const s = parseInt(start, 10);
      const e = stop === -1 || stop === '-1' ? sorted.length : parseInt(stop, 10) + 1;
      return { result: sorted.slice(s, e) };
    }
    default: return { result: null };
  }
}

function mockRequest(opts, cb) {
  const path   = typeof opts === 'string' ? opts : (opts.path || '');
  const method = typeof opts === 'object' ? (opts.method || 'GET') : 'GET';
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
    on() { return req; },
    end() {
      let responseData;
      if (method === 'GET') {
        const m = path.match(/\/get\/([^?]+)/);
        if (m) {
          const key = decodeURIComponent(m[1]);
          const val = Object.prototype.hasOwnProperty.call(_kv, key) ? _kv[key] : null;
          responseData = JSON.stringify({ result: val });
        } else {
          responseData = JSON.stringify({ result: null });
        }
      } else {
        let cmds = [];
        try { cmds = JSON.parse(bodyChunks.join('')); } catch { cmds = []; }
        const results = Array.isArray(cmds) ? cmds.map(execCmd) : [];
        responseData = JSON.stringify(results);
      }
      if (cb) cb(res);
      if (res._dataHandler) res._dataHandler(responseData);
      if (res._endHandler)  res._endHandler();
    },
  };
  return req;
}

https.request = mockRequest;

function setFlagEnabled(name, enabled) {
  _kv['flags:' + name] = JSON.stringify({ enabled });
}

const { createNotification } = require('../_lib/notifications.js');
const handler = require('./counts.js');

function makeReq(method = 'GET') {
  return { method, query: {}, body: {} };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.setHeader = () => res;
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body) => { res._body  = body; return res; };
  res.end    = () => res;
  return res;
}

describe('GET /api/notifications/counts', () => {
  beforeEach(() => {
    clearStore();
    setFlagEnabled('notifications_center', true);
  });

  it('returns ok with zero counts when flag is off (graceful empty state)', async () => {
    setFlagEnabled('notifications_center', false);
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.ok(res._body.ok);
    assert.equal(res._body.unread_count, 0);
    assert.deepEqual(res._body.by_type, {});
  });

  it('returns ok with zero counts when store is empty', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.ok(res._body.ok);
    assert.equal(res._body.unread_count, 0);
    assert.deepEqual(res._body.by_type, {});
  });

  it('counts unread notifications by type', async () => {
    await createNotification({ type: 'follow_up_due', title: 'FU 1', body: '' });
    await createNotification({ type: 'follow_up_due', title: 'FU 2', body: '' });
    await createNotification({ type: 'deposit_overdue', title: 'Dep 1', body: '' });

    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res._status, 200);
    assert.ok(res._body.ok);
    assert.equal(res._body.unread_count, 3);
    assert.equal(res._body.by_type.follow_up_due, 2);
    assert.equal(res._body.by_type.deposit_overdue, 1);
  });

  it('returns 405 for non-GET methods', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    assert.equal(res._status, 405);
  });

  it('handles OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq('OPTIONS'), res);
    assert.equal(res._status, 200);
  });
});
