'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── test-mode.js runs as a browser IIFE and relies on window globals.
// We shim the minimum required to exercise the exported functions.
global.window = global.window || {};
global.window.showTestData = false;
global.window.flags = { isEnabled: () => false };
// Suppress DOM calls in renderTestControls / showToast
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  createElement: () => ({ style: {}, textContent: '', remove() {} }),
  body: { appendChild() {} },
};

// Load the module — it registers window.testMode
require('./test-mode.js');

const { isTestInquiry, shouldShowInquiry } = global.window.testMode;

// ── isTestInquiry ─────────────────────────────────────────────────────────────
describe('isTestInquiry', () => {
  it('returns true when test=true', () => {
    assert.ok(isTestInquiry({ threadId: 'abc123', test: true }));
  });

  it('returns true when threadId starts with test-', () => {
    assert.ok(isTestInquiry({ threadId: 'test-1234567890' }));
  });

  it('returns false for a real inquiry', () => {
    assert.ok(!isTestInquiry({ threadId: '18f4ab12cd', test: false }));
  });

  it('returns false when test=false and threadId is normal', () => {
    assert.ok(!isTestInquiry({ threadId: 'thread-abc', test: false }));
  });

  it('returns false for null', () => {
    assert.ok(!isTestInquiry(null));
  });

  it('returns false for empty object', () => {
    assert.ok(!isTestInquiry({}));
  });

  it('does not false-positive on threadId containing "test" mid-string', () => {
    assert.ok(!isTestInquiry({ threadId: 'protest-123', test: false }));
  });
});

// ── shouldShowInquiry ─────────────────────────────────────────────────────────
describe('shouldShowInquiry', () => {
  it('real inquiry always shown', () => {
    global.window.showTestData = false;
    assert.ok(shouldShowInquiry({ threadId: 'real-thread', test: false }));
  });

  it('test inquiry hidden when showTestData=false', () => {
    global.window.showTestData = false;
    assert.ok(!shouldShowInquiry({ threadId: 'test-123', test: true }));
  });

  it('test inquiry visible when showTestData=true', () => {
    global.window.showTestData = true;
    assert.ok(shouldShowInquiry({ threadId: 'test-123', test: true }));
  });

  it('test- prefix inquiry hidden when showTestData=false', () => {
    global.window.showTestData = false;
    assert.ok(!shouldShowInquiry({ threadId: 'test-9999', test: false }));
  });

  it('test- prefix inquiry visible when showTestData=true', () => {
    global.window.showTestData = true;
    assert.ok(shouldShowInquiry({ threadId: 'test-9999', test: false }));
  });
});

// ── resolveRecipient (dispatch/email.js) ──────────────────────────────────────
describe('resolveRecipient', () => {
  const { resolveRecipient } = require('../../api/dispatch/email.js');

  it('returns original to for a normal inquiry', () => {
    const to = resolveRecipient('customer@example.com', { inquiry: { test: false, threadId: 'real-abc' } });
    assert.equal(to, 'customer@example.com');
  });

  it('redirects to zak9494@gmail.com when inquiry.test=true', () => {
    const to = resolveRecipient('customer@example.com', { inquiry: { test: true, threadId: 'test-123' } });
    assert.equal(to, 'zak9494@gmail.com');
  });

  it('redirects when testOverride=true regardless of inquiry', () => {
    const to = resolveRecipient('customer@example.com', { testOverride: true, inquiry: { test: false } });
    assert.equal(to, 'zak9494@gmail.com');
  });

  it('redirects when threadId starts with test- even if test field absent', () => {
    const to = resolveRecipient('customer@example.com', { inquiry: { threadId: 'test-999' } });
    assert.equal(to, 'zak9494@gmail.com');
  });

  it('never changes the sender — only recipient is checked', () => {
    // resolveRecipient only takes `to` + context; it knows nothing about `from`
    // This test asserts the return value is always an email string (not a sender address)
    const result = resolveRecipient('customer@example.com', { inquiry: { test: true } });
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('@'));
    assert.notEqual(result, 'info@blusbarbeque.com');
  });

  it('returns to unchanged when no context provided', () => {
    const to = resolveRecipient('someone@example.com', {});
    assert.equal(to, 'someone@example.com');
  });
});
