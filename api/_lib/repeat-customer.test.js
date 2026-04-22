/**
 * Unit tests for api/_lib/repeat-customer.js
 * Run with: node --test api/_lib/repeat-customer.test.js
 */
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');

// Stub out https + env so lookup uses our injected index
const https = require('https');
let _fakeIndex = [];

// Intercept kvGet by patching the require cache after the fact
// We need to load the module with a fake KV. Use module isolation via re-require.
process.env.KV_REST_API_URL   = 'https://fake-kv.example.com';
process.env.KV_REST_API_TOKEN = 'fake-token';

// Monkey-patch https.request so every GET to the KV returns our fake index
const origRequest = https.request.bind(https);
https.request = function(opts, cb) {
  // Return the fake index for any KV get request
  const body = JSON.stringify({ result: JSON.stringify(_fakeIndex) });
  let called = false;
  const fakeRes = {
    statusCode: 200,
    on(event, handler) {
      if (event === 'data' && !called) { called = true; handler(body); }
      if (event === 'end') handler();
      return fakeRes;
    }
  };
  setImmediate(() => cb(fakeRes));
  return { on() {}, end() {} };
};

// Re-require module so it picks up the patched https
delete require.cache[require.resolve('./repeat-customer')];
const { lookup } = require('./repeat-customer');

// Helper: clear module cache TTL between tests
function clearCache() {
  // Access the private cache through re-requiring — just advance time isn't possible,
  // so we reload the module fresh each test group by deleting cache entry.
  delete require.cache[require.resolve('./repeat-customer')];
  const fresh = require('./repeat-customer');
  return fresh.lookup;
}

test('empty history → status none', async () => {
  _fakeIndex = [];
  const lk = clearCache();
  const r = await lk('customer@example.com', null);
  assert.equal(r.status, 'none');
  assert.equal(r.count, 0);
  assert.equal(r.bookedCount, 0);
});

test('prior inquiry only → status prior_inquiry', async () => {
  _fakeIndex = [
    { threadId: 't1', from: 'Alice <alice@example.com>', status: 'quote_sent', event_date: '2026-01-10' }
  ];
  const lk = clearCache();
  const r = await lk('alice@example.com', null);
  assert.equal(r.status, 'prior_inquiry');
  assert.equal(r.count, 1);
  assert.equal(r.bookedCount, 0);
});

test('booked inquiry → status booked_and_paid', async () => {
  _fakeIndex = [
    { threadId: 't2', from: 'Bob <bob@example.com>', status: 'booked', event_date: '2026-03-14', quote_total: '1200' }
  ];
  const lk = clearCache();
  const r = await lk('bob@example.com', null);
  assert.equal(r.status, 'booked_and_paid');
  assert.equal(r.bookedCount, 1);
  assert.equal(r.lastEventDate, '2026-03-14');
  assert.equal(r.lastAmount, 1200);
});

test('completed inquiry counts as booked_and_paid', async () => {
  _fakeIndex = [
    { threadId: 't3', from: 'carol@example.com', status: 'completed', event_date: '2025-11-20', quote_total: '850' }
  ];
  const lk = clearCache();
  const r = await lk('carol@example.com', null);
  assert.equal(r.status, 'booked_and_paid');
  assert.equal(r.bookedCount, 1);
});

test('multi-booking counts correctly', async () => {
  _fakeIndex = [
    { threadId: 't4', from: 'dave@example.com', status: 'booked', event_date: '2025-06-01', quote_total: '500' },
    { threadId: 't5', from: 'dave@example.com', status: 'completed', event_date: '2026-02-14', quote_total: '900' },
    { threadId: 't6', from: 'dave@example.com', status: 'quote_sent', event_date: '2026-08-01' }
  ];
  const lk = clearCache();
  const r = await lk('dave@example.com', null);
  assert.equal(r.status, 'booked_and_paid');
  assert.equal(r.count, 3);
  assert.equal(r.bookedCount, 2);
  assert.equal(r.lastEventDate, '2026-02-14');
});

test('excludeThreadId removes that record', async () => {
  _fakeIndex = [
    { threadId: 'current', from: 'eve@example.com', status: 'quote_sent', event_date: '2026-05-01' }
  ];
  const lk = clearCache();
  const r = await lk('eve@example.com', 'current');
  assert.equal(r.status, 'none');
  assert.equal(r.count, 0);
});

test('archived inquiries are excluded', async () => {
  _fakeIndex = [
    { threadId: 't7', from: 'frank@example.com', status: 'archived', event_date: '2025-09-01' }
  ];
  const lk = clearCache();
  const r = await lk('frank@example.com', null);
  assert.equal(r.status, 'none');
});

test('email in extracted_fields is used', async () => {
  _fakeIndex = [
    {
      threadId: 't8',
      from: 'noreply@form.com',
      extracted_fields: { customer_email: 'Grace@Example.COM' },
      status: 'booked',
      event_date: '2026-04-01',
      quote_total: '700'
    }
  ];
  const lk = clearCache();
  const r = await lk('grace@example.com', null);
  assert.equal(r.status, 'booked_and_paid');
});
