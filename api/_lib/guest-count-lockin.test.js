'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
process.env.KV_REST_API_TOKEN = 'mock-token';

// ── KV mock ───────────────────────────────────────────────────────────────────
const https = require('https');
const _kv = {};

function clearStore() { Object.keys(_kv).forEach(k => delete _kv[k]); }

https.request = function mockRequest(opts, cb) {
  const path   = typeof opts === 'string' ? opts : (opts.path || '');
  const method = typeof opts === 'object' ? (opts.method || 'GET') : 'GET';
  const bodyChunks = [];

  // Stub createNotification's KV calls (ZADD, INCR) — just return OK
  const res = {
    statusCode: 200,
    on(ev, h) { if (ev === 'data') res._data = h; if (ev === 'end') res._end = h; return res; },
    resume() { return res; },
  };
  const req = {
    write(c) { bodyChunks.push(c); },
    end() {
      let responseBody;
      if (method === 'GET') {
        const m = path.match(/\/get\/([^?]+)/);
        const key = m ? decodeURIComponent(m[1]) : '';
        responseBody = JSON.stringify({ result: _kv[key] !== undefined ? _kv[key] : null });
      } else {
        let cmds = [];
        try { cmds = JSON.parse(bodyChunks.join('')); } catch { cmds = []; }
        const results = cmds.map(c => {
          if (c[0] === 'SET') { _kv[c[1]] = c[2]; return { result: 'OK' }; }
          if (c[0] === 'ZADD' || c[0] === 'INCR') return { result: 1 };
          return { result: null };
        });
        responseBody = JSON.stringify(results);
      }
      if (cb) cb(res);
      if (res._data) res._data(responseBody);
      if (res._end)  res._end();
    },
    on() { return req; },
  };
  return req;
};

const { getLockinDays, setLockinDays, checkGuestCountLockin, daysUntil } = require('./guest-count-lockin.js');

beforeEach(clearStore);

describe('daysUntil', () => {
  it('returns 0 when event is today', () => {
    assert.equal(daysUntil('2026-08-01', '2026-08-01'), 0);
  });

  it('returns 7 when event is one week away', () => {
    assert.equal(daysUntil('2026-08-08', '2026-08-01'), 7);
  });

  it('returns negative for past dates', () => {
    assert.ok(daysUntil('2026-07-25', '2026-08-01') < 0);
  });
});

describe('getLockinDays / setLockinDays', () => {
  it('defaults to 0 when not set', async () => {
    const days = await getLockinDays();
    assert.equal(days, 0);
  });

  it('returns 0 for negative or NaN values', async () => {
    _kv['settings:guest_count_lockin_days'] = '-5';
    const days = await getLockinDays();
    assert.equal(days, 0);
  });

  it('persists value via setLockinDays', async () => {
    await setLockinDays(14);
    const days = await getLockinDays();
    assert.equal(days, 14);
  });

  it('throws on negative value', async () => {
    await assert.rejects(() => setLockinDays(-1), /non-negative integer/);
  });

  it('throws on non-numeric value', async () => {
    await assert.rejects(() => setLockinDays('abc'), /non-negative integer/);
  });
});

describe('checkGuestCountLockin', () => {
  it('returns null when status is not booked', async () => {
    const inq = { status: 'quote_sent', extracted_fields: { event_date: '2026-08-08' } };
    const result = await checkGuestCountLockin(inq);
    assert.equal(result, null);
  });

  it('returns null when lockin is disabled (days=0)', async () => {
    const inq = {
      status: 'booked',
      threadId: 'thread-1',
      extracted_fields: { event_date: '2026-08-08', customer_name: 'Bob' },
    };
    // lockinDays is 0 by default → disabled
    const result = await checkGuestCountLockin(inq);
    assert.equal(result, null);
  });

  it('returns null when final_guest_count is already set', async () => {
    await setLockinDays(7);
    const inq = {
      status: 'booked',
      final_guest_count: 80,
      extracted_fields: { event_date: '2026-08-08' },
    };
    const result = await checkGuestCountLockin(inq);
    assert.equal(result, null);
  });

  it('returns null when no event_date', async () => {
    await setLockinDays(7);
    const inq = { status: 'booked', extracted_fields: {} };
    const result = await checkGuestCountLockin(inq);
    assert.equal(result, null);
  });
});
