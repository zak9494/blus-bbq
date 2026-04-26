'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { log } = require('./logger');
const { withRequestId, HEADER } = require('../api/_middleware/request-id');

// Capture stdout/stderr from console so we can assert on log lines.
// Always awaits the callback so async test bodies see their own writes
// before the originals get restored.
async function captureConsole(fn) {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (s) => out.push(String(s));
  console.warn = (s) => err.push(String(s));
  console.error = (s) => err.push(String(s));
  try {
    return await fn(out, err);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
  }
}

test('log.info writes a single JSON line with ts, level, msg, ctx', async () => {
  await captureConsole((out) => {
    log.info('hello', { user: 'zach' });
    assert.equal(out.length, 1);
    const obj = JSON.parse(out[0]);
    assert.equal(obj.level, 'info');
    assert.equal(obj.msg, 'hello');
    assert.equal(obj.user, 'zach');
    assert.ok(typeof obj.ts === 'string' && obj.ts.length > 0);
  });
});

test('log.error with Error includes stack and name', () => {
  captureConsole((_out, err) => {
    const e = new TypeError('bad input');
    log.error(e, { route: '/foo' });
    assert.equal(err.length, 1);
    const obj = JSON.parse(err[0]);
    assert.equal(obj.level, 'error');
    assert.equal(obj.msg, 'bad input');
    assert.equal(obj.name, 'TypeError');
    assert.equal(obj.route, '/foo');
    assert.match(obj.stack, /TypeError: bad input/);
  });
});

test('log.error with string still writes valid JSON', () => {
  captureConsole((_out, err) => {
    log.error('plain message', { tag: 'x' });
    const obj = JSON.parse(err[0]);
    assert.equal(obj.level, 'error');
    assert.equal(obj.msg, 'plain message');
    assert.equal(obj.tag, 'x');
  });
});

test('log.child binds ctx into every line', () => {
  captureConsole((out) => {
    const child = log.child({ request_id: 'abc', route: '/x' });
    child.info('msg-1');
    child.info('msg-2', { extra: 1 });
    const a = JSON.parse(out[0]);
    const b = JSON.parse(out[1]);
    assert.equal(a.request_id, 'abc');
    assert.equal(a.route, '/x');
    assert.equal(b.request_id, 'abc');
    assert.equal(b.extra, 1);
  });
});

test('withRequestId injects ctx.log + ctx.request_id and echoes header', async () => {
  let captured;
  const handler = withRequestId(async (req, res, ctx) => {
    captured = ctx;
    res.statusCode = 200;
    return 'ok';
  });
  const headers = {};
  const req = { url: '/api/test?x=1', method: 'POST', headers: {} };
  const res = {
    statusCode: 0,
    setHeader: (k, v) => {
      headers[k] = v;
    },
  };
  const out = await captureConsole(async (logs) => {
    const r = await handler(req, res);
    return { r, logs };
  });
  assert.equal(out.r, 'ok');
  assert.ok(captured.request_id, 'ctx.request_id set');
  assert.ok(headers[HEADER], 'response echoes x-request-id header');
  assert.equal(headers[HEADER], captured.request_id);
});

test('withRequestId reuses incoming request_id when present', async () => {
  const handler = withRequestId(async (req, res, ctx) => {
    res.statusCode = 200;
    return ctx.request_id;
  });
  const headers = {};
  const incoming = '11111111-2222-3333-4444-555555555555';
  const req = { url: '/api/test', method: 'GET', headers: { [HEADER]: incoming } };
  const res = { statusCode: 0, setHeader: (k, v) => (headers[k] = v) };
  await captureConsole(async () => {
    const id = await handler(req, res);
    assert.equal(id, incoming);
    assert.equal(headers[HEADER], incoming);
  });
});

test('withRequestId logs error and rethrows when handler throws', async () => {
  const handler = withRequestId(async () => {
    throw new Error('boom');
  });
  const req = { url: '/api/x', method: 'GET', headers: {} };
  const res = { statusCode: 500, setHeader: () => {} };
  let thrown = null;
  await captureConsole(async (_out, err) => {
    try {
      await handler(req, res);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown);
    assert.equal(thrown.message, 'boom');
    const last = JSON.parse(err[err.length - 1]);
    assert.equal(last.level, 'error');
    assert.equal(last.msg, 'boom');
    assert.ok(last.request_id);
  });
});
