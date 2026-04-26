/* ===== TEST: api/calendar/delete.js — soft-delete + confirmation guard
   Past events  → 403 (no soft), 200 hidden (soft:true)
   Future events → 200 requiresConfirmation (no confirmed), 200 ok (confirmed:true)
   Unknown date  → fail open, attempt deletion
   Uses a stub for _gcal; no real Google Calendar or KV calls are made.
   ===== */
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

/* ── Helpers ──────────────────────────────────────── */
function makeReq(eventId, body) {
  return { method: 'DELETE', query: { eventId: eventId || 'ev123' }, body: body || {} };
}
function makeRes() {
  const res = { _status: 200, _body: null };
  res.status    = function (s) { res._status = s; return res; };
  res.json      = function (b) { res._body = b; return res; };
  res.end       = function () { return res; };
  res.setHeader = function () {};
  return res;
}

/* ── In-memory KV stub ───────────────────────────── */
const _kvStore = {};
function kvStubGet(key) {
  return Promise.resolve(Object.prototype.hasOwnProperty.call(_kvStore, key) ? _kvStore[key] : null);
}
function kvStubSet(key, val) {
  _kvStore[key] = typeof val === 'string' ? val : JSON.stringify(val);
  return Promise.resolve();
}
function clearKv() { Object.keys(_kvStore).forEach(k => delete _kvStore[k]); }

/* ── Stub _gcal module ────────────────────────────── */
let _gcalImpl = null;
const gcalStub = {
  getAccessToken:        async () => 'tok',
  getOrCreateCalendarId: async () => 'cal@group.calendar.google.com',
  gcalRequest:           async (...args) => _gcalImpl(...args),
  kvGet:                 kvStubGet,
  kvSet:                 kvStubSet,
};

require.cache[require.resolve('./_gcal')] = {
  id:       require.resolve('./_gcal'),
  filename: require.resolve('./_gcal'),
  loaded:   true,
  exports:  gcalStub,
};

/* Load handler AFTER the cache stub is in place */
const handler = require('./delete.js');

/* ── Past-event guard ──────────────────────────────── */
describe('delete.js — past-event guard', () => {

  test('blocks deletion of a past event (403)', async () => {
    clearKv();
    // Use 2 days ago (not 1) to avoid the UTC-midnight/Chicago-timezone edge case where
    // "yesterday UTC" === "today Chicago" and the past-event guard incorrectly misses.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const pastDate = yesterday.toISOString().slice(0, 10) + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET') return { status: 200, body: { start: { dateTime: pastDate } } };
      return { status: 204, body: null };
    };

    const res = makeRes();
    await handler(makeReq('ev-past'), res);
    assert.equal(res._status, 403, 'should be 403 for past event without soft flag');
    assert.ok(res._body.error.toLowerCase().includes('past'), 'error should mention past');
  });

  test('soft-deletes a past event (200, hidden:true, written to KV)', async () => {
    clearKv();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const pastDate = yesterday.toISOString().slice(0, 10) + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET') return { status: 200, body: { start: { dateTime: pastDate } } };
      // DELETE should NOT be called for a soft-delete
      if (method === 'DELETE') throw new Error('DELETE must not be called for soft-delete');
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-past-soft', { soft: true }), res);
    assert.equal(res._status, 200, 'should be 200 for soft-delete');
    assert.equal(res._body.ok, true);
    assert.equal(res._body.hidden, true);

    // KV should contain the event ID in the hidden list
    const raw = _kvStore['calendar:hidden'];
    assert.ok(raw, 'calendar:hidden should be written to KV');
    const list = JSON.parse(raw);
    assert.ok(Array.isArray(list) && list.includes('ev-past-soft'), 'event ID should be in hidden list');
  });

  test('soft-delete does not duplicate IDs in hidden list', async () => {
    clearKv();
    // Pre-seed with the event already in the list
    _kvStore['calendar:hidden'] = JSON.stringify(['ev-already-hidden']);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const pastDate = yesterday.toISOString().slice(0, 10) + 'T12:00:00-05:00';
    _gcalImpl = async (method) => {
      if (method === 'GET') return { status: 200, body: { start: { dateTime: pastDate } } };
      return { status: 204, body: null };
    };

    const res = makeRes();
    await handler(makeReq('ev-already-hidden', { soft: true }), res);
    assert.equal(res._status, 200);
    const list = JSON.parse(_kvStore['calendar:hidden']);
    assert.equal(list.filter(id => id === 'ev-already-hidden').length, 1, 'no duplicates');
  });

});

/* ── Future-event confirmation guard ──────────────── */
describe('delete.js — future-event confirmation guard', () => {

  test('future event without confirmed → requiresConfirmation:true (200)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const futureDate = tomorrow.toISOString().slice(0, 10) + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET') return { status: 200, body: { start: { dateTime: futureDate } } };
      if (method === 'DELETE') throw new Error('DELETE must not be called without confirmation');
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-future'), res);
    assert.equal(res._status, 200, 'should be 200');
    assert.equal(res._body.requiresConfirmation, true, 'should signal confirmation required');
  });

  test('future event with confirmed:true → ok:true (actual delete)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const futureDate = tomorrow.toISOString().slice(0, 10) + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET')    return { status: 200, body: { start: { dateTime: futureDate } } };
      if (method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-future-confirmed', { confirmed: true }), res);
    assert.equal(res._status, 200, 'should be 200 for confirmed future delete');
    assert.equal(res._body.ok, true);
    assert.ok(!res._body.requiresConfirmation, 'should not have requiresConfirmation in response');
  });

  test('today\'s event → requiresConfirmation (not treated as past)', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const todayDT = today + 'T12:00:00-05:00';

    _gcalImpl = async (method) => {
      if (method === 'GET')    return { status: 200, body: { start: { dateTime: todayDT } } };
      if (method === 'DELETE') throw new Error('DELETE must not be called without confirmation');
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-today'), res);
    assert.equal(res._status, 200, 'today\'s event should not 403');
    assert.equal(res._body.requiresConfirmation, true, 'should require confirmation for today');
  });

});

/* ── Fail-open / edge cases ───────────────────────── */
describe('delete.js — fail-open and edge cases', () => {

  test('allows deletion when GET cannot find the event (graceful fallback)', async () => {
    _gcalImpl = async (method) => {
      if (method === 'GET')    return { status: 404, body: null };
      if (method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: {} };
    };

    const res = makeRes();
    await handler(makeReq('ev-notfound'), res);
    assert.equal(res._status, 200, 'should allow deletion when event GET returns 404');
    assert.equal(res._body.ok, true);
  });

  test('missing eventId → 400', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', query: {}, body: {} }, res);
    assert.equal(res._status, 400);
  });

});
