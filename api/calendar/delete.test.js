/* ===== TEST: api/calendar/delete.js — never-delete guarantee
   Verifies that attempting to delete a past event returns HTTP 403.
   Uses a stub for _gcal so no real Google Calendar calls are made.
   ===== */
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

/* ── Helpers ──────────────────────────────────────── */
function makeReq(eventId) {
  return { method: 'DELETE', query: { eventId: eventId || 'ev123' }, body: {} };
}
function makeRes() {
  const res = { _status: 200, _body: null };
  res.status    = function (s) { res._status = s; return res; };
  res.json      = function (b) { res._body = b; return res; };
  res.end       = function () { return res; };
  res.setHeader = function () {};
  return res;
}

/* ── Stub _gcal module ────────────────────────────── */
/* gcalRequest is a forwarding wrapper so per-test assignment works even after
   destructuring inside delete.js. The handler sees the wrapper, which calls
   whichever implementation is assigned to _impl at call time.             */
let _gcalImpl = null;
const gcalStub = {
  getAccessToken:        async () => 'tok',
  getOrCreateCalendarId: async () => 'cal@group.calendar.google.com',
  gcalRequest:           async (...args) => _gcalImpl(...args),
};

require.cache[require.resolve('./_gcal')] = {
  id:       require.resolve('./_gcal'),
  filename: require.resolve('./_gcal'),
  loaded:   true,
  exports:  gcalStub,
};

/* Load handler AFTER the cache stub is in place */
const handler = require('./delete.js');

/* ── Tests ─────────────────────────────────────────── */
describe('delete.js — never-delete guarantee', () => {

  test('blocks deletion of a past event (403)', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pastDate = yesterday.toISOString().slice(0, 10) + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET') return { status: 200, body: { start: { dateTime: pastDate } } };
      return { status: 204, body: null };
    };

    const res = makeRes();
    await handler(makeReq('ev-past'), res);
    assert.equal(res._status, 403, 'should be 403 for past event');
    assert.ok(res._body.error.toLowerCase().includes('past'), 'error should mention past');
  });

  test('allows deletion of a future event (200)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const futureDate = tomorrow.toISOString().slice(0, 10) + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET')    return { status: 200, body: { start: { dateTime: futureDate } } };
      if (method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-future'), res);
    assert.equal(res._status, 200, 'should be 200 for future event');
    assert.equal(res._body.ok, true);
  });

  test('allows deletion when GET cannot find the event (graceful fallback)', async () => {
    _gcalImpl = async (method) => {
      if (method === 'GET')    return { status: 404, body: null };
      if (method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-notfound'), res);
    /* When we cannot confirm the date, fail open and allow the deletion */
    assert.equal(res._status, 200, 'should allow deletion when event GET returns 404');
  });

  test('today\'s event is deletable (guard uses strict less-than)', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const todayDT = today + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET')    return { status: 200, body: { start: { dateTime: todayDT } } };
      if (method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-today'), res);
    /* evDate < todayStr is false for today → allowed */
    assert.equal(res._status, 200, 'today\'s event should be deletable');
  });

});
