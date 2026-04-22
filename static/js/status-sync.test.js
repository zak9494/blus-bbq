/**
 * Unit tests for static/js/status-sync.js
 * Run with: node --test static/js/status-sync.test.js
 *
 * The module expects a browser global environment; we shim what's needed.
 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Shims
global.INQ_SECRET = 'test-secret';
global.calAutoCreateOnBooking = null; // disabled in tests
global.showToast = () => {};

// Capture fetch calls
let _lastFetchArgs = null;
let _fetchShouldFail = false;
let _fetchResponseOk = true;
let _fetchResponseBody = { ok: true };

global.fetch = function (url, opts) {
  _lastFetchArgs = { url, opts };
  if (_fetchShouldFail) return Promise.reject(new Error('network error'));
  return Promise.resolve({
    ok: _fetchResponseOk,
    json: () => Promise.resolve(_fetchResponseBody)
  });
};

// Load the module (it wraps itself in an IIFE and sets window.statusSync)
global.window = global;
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/status-sync.js', 'utf8');
// eslint-disable-next-line no-new-func
new Function(code)();

function resetSync() {
  // Re-load module fresh each time by re-running the IIFE
  // Actually easier: just hydrate a clean state
  window.statusSync._hydrate([]);  // reset to empty
  _lastFetchArgs = null;
  _fetchShouldFail = false;
  _fetchResponseOk = true;
  _fetchResponseBody = { ok: true };
}

// We need a proper reset — re-execute the module for clean _store/_listeners
function freshModule() {
  // Clear listeners by overwriting window.statusSync
  new Function(code)();
  _lastFetchArgs = null;
  _fetchShouldFail = false;
  _fetchResponseOk = true;
  _fetchResponseBody = { ok: true };
}

test('get returns null for unknown id', () => {
  freshModule();
  assert.equal(window.statusSync.get('unknown'), null);
});

test('_hydrate seeds store from inquiry array', () => {
  freshModule();
  window.statusSync._hydrate([
    { threadId: 'a', status: 'needs_info' },
    { threadId: 'b', status: 'booked' }
  ]);
  assert.equal(window.statusSync.get('a'), 'needs_info');
  assert.equal(window.statusSync.get('b'), 'booked');
});

test('set fires listener optimistically', async () => {
  freshModule();
  window.statusSync._hydrate([{ threadId: 'x', status: 'needs_info' }]);
  const events = [];
  window.statusSync.onChange(function (id, ns, ps) { events.push({ id, ns, ps }); });
  await window.statusSync.set('x', 'quote_drafted');
  assert.equal(events.length >= 1, true);
  assert.equal(events[0].id, 'x');
  assert.equal(events[0].ns, 'quote_drafted');
  assert.equal(events[0].ps, 'needs_info');
});

test('set sends PATCH to /api/inquiries/save', async () => {
  freshModule();
  window.statusSync._hydrate([{ threadId: 'y', status: 'needs_info' }]);
  await window.statusSync.set('y', 'booked');
  assert.ok(_lastFetchArgs, 'fetch was called');
  assert.ok(_lastFetchArgs.url.includes('/api/inquiries/save'), 'correct endpoint');
  const body = JSON.parse(_lastFetchArgs.opts.body);
  assert.equal(body.threadId, 'y');
  assert.equal(body.status, 'booked');
});

test('set rolls back on fetch failure + fires listeners with prev', async () => {
  freshModule();
  window.statusSync._hydrate([{ threadId: 'z', status: 'needs_info' }]);
  _fetchShouldFail = true;
  const events = [];
  window.statusSync.onChange(function (id, ns) { events.push(ns); });
  try { await window.statusSync.set('z', 'booked'); } catch (_) {}
  // Should have fired optimistic (booked) then rollback (needs_info)
  assert.equal(events[0], 'booked');
  assert.equal(events[1], 'needs_info');
  assert.equal(window.statusSync.get('z'), 'needs_info');
});

test('set rolls back on non-ok API response', async () => {
  freshModule();
  window.statusSync._hydrate([{ threadId: 'w', status: 'quote_drafted' }]);
  _fetchResponseOk = false;
  try { await window.statusSync.set('w', 'booked'); } catch (_) {}
  assert.equal(window.statusSync.get('w'), 'quote_drafted');
});

test('set is no-op when status is unchanged', async () => {
  freshModule();
  window.statusSync._hydrate([{ threadId: 'same', status: 'booked' }]);
  const events = [];
  window.statusSync.onChange(function () { events.push(1); });
  await window.statusSync.set('same', 'booked');
  assert.equal(events.length, 0, 'no listener fired');
  assert.equal(_lastFetchArgs, null, 'no fetch for same status');
});

test('three surfaces share the same store', async () => {
  freshModule();
  window.statusSync._hydrate([{ threadId: 'shared', status: 'needs_info' }]);
  // Simulate Kanban column move
  await window.statusSync.set('shared', 'quote_drafted');
  // Simulate List view drop-down checking state
  assert.equal(window.statusSync.get('shared'), 'quote_drafted');
  // Simulate Pipeline list drop-down changing it
  await window.statusSync.set('shared', 'booked');
  assert.equal(window.statusSync.get('shared'), 'booked');
});
