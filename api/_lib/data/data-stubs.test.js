/* Unit tests for the Phase 1 entity-stub modules.
   Verifies the public surface and that input-validation errors fire
   without ever touching KV. We do not mock the network — tests stay
   inside the input-validation paths. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert');

const deposits      = require('./deposits.js');
const notifications = require('./notifications.js');
const inquiries     = require('./inquiries.js');
const quotes        = require('./quotes.js');
const chat          = require('./chat.js');

test('deposits module exposes the expected surface', () => {
  assert.strictEqual(typeof deposits.listDepositsByThread, 'function');
  assert.strictEqual(typeof deposits.setDepositsForThread, 'function');
  assert.strictEqual(deposits.KEY('abc'), 'deposits:abc');
});

test('deposits.setDepositsForThread rejects bad input pre-network', async () => {
  await assert.rejects(() => deposits.setDepositsForThread('', []),       /threadId required/);
  await assert.rejects(() => deposits.setDepositsForThread('t', 'not-arr'), /must be an array/);
});

test('deposits.listDepositsByThread requires threadId', async () => {
  await assert.rejects(() => deposits.listDepositsByThread(''), /threadId required/);
});

test('notifications module exposes the expected surface', () => {
  assert.strictEqual(typeof notifications.listNotifications, 'function');
  assert.strictEqual(typeof notifications.setNotifications, 'function');
  assert.strictEqual(typeof notifications.listSubscriptions, 'function');
  assert.strictEqual(typeof notifications.setSubscriptions, 'function');
  assert.strictEqual(notifications.LIST_KEY, 'notifications:list');
  assert.strictEqual(notifications.SUBS_KEY, 'push:subscriptions');
});

test('notifications.setNotifications rejects non-array', async () => {
  await assert.rejects(() => notifications.setNotifications('nope'), /must be an array/);
  await assert.rejects(() => notifications.setSubscriptions({}),     /must be an array/);
});

test('inquiries module exposes the expected surface', () => {
  assert.strictEqual(typeof inquiries.getInquiry, 'function');
  assert.strictEqual(typeof inquiries.setInquiry, 'function');
  assert.strictEqual(typeof inquiries.listInquiries, 'function');
  assert.strictEqual(typeof inquiries.setInquiriesIndex, 'function');
  assert.strictEqual(inquiries.INDEX_KEY, 'inquiries:index');
  assert.strictEqual(inquiries.RECORD_KEY('thr_x'), 'inquiries:thr_x');
});

test('inquiries.setInquiry rejects bad input', async () => {
  await assert.rejects(() => inquiries.setInquiry('', { a: 1 }),    /threadId required/);
  await assert.rejects(() => inquiries.setInquiry('t', null),       /must be an object/);
  await assert.rejects(() => inquiries.setInquiriesIndex('not-arr'), /must be an array/);
});

test('quotes module exposes the expected surface', () => {
  assert.strictEqual(typeof quotes.getDraft, 'function');
  assert.strictEqual(typeof quotes.setDraft, 'function');
  assert.strictEqual(typeof quotes.listTemplates, 'function');
  assert.strictEqual(quotes.DRAFT_KEY('t'), 'quotes:draft:t');
  assert.strictEqual(quotes.TEMPLATE_KEY('id1'), 'quotes:template:id1');
  assert.strictEqual(quotes.TEMPLATE_INDEX_KEY, 'quotes:templates:_index');
});

test('quotes.setDraft rejects bad input', async () => {
  await assert.rejects(() => quotes.setDraft('', { x: 1 }), /threadId required/);
  await assert.rejects(() => quotes.setDraft('t', null),    /must be an object/);
});

test('chat module exposes the expected surface', () => {
  assert.strictEqual(typeof chat.getHistory, 'function');
  assert.strictEqual(typeof chat.setHistory, 'function');
  assert.strictEqual(typeof chat.getApprovalQueue, 'function');
  assert.strictEqual(typeof chat.setApprovalQueue, 'function');
  assert.strictEqual(chat.HISTORY_KEY, 'chat:history');
  assert.strictEqual(chat.APPROVAL_KEY, 'chat:approval:queue');
  assert.strictEqual(chat.HISTORY_MAX, 100);
  assert.strictEqual(chat.APPROVAL_MAX, 20);
});

test('chat.setHistory rejects non-array', async () => {
  await assert.rejects(() => chat.setHistory('nope'),         /must be an array/);
  await assert.rejects(() => chat.setApprovalQueue({}),       /must be an array/);
});
