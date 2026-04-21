'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isPermanentError } = require('./send.js');

describe('isPermanentError', () => {
  describe('falsy / missing', () => {
    it('returns false for null', ()  => assert.ok(!isPermanentError(null)));
    it('returns false for undefined', () => assert.ok(!isPermanentError(undefined)));
    it('returns false for empty object', () => assert.ok(!isPermanentError({})));
  });

  describe('410 / 404 — subscription gone', () => {
    it('410 → permanent', () => assert.ok(isPermanentError({ statusCode: 410 })));
    it('404 → permanent', () => assert.ok(isPermanentError({ statusCode: 404 })));
  });

  describe('403 — push service permanently rejects', () => {
    it('403 → permanent', () => assert.ok(isPermanentError({ statusCode: 403 })));
  });

  describe('400 with body keywords', () => {
    it('VapidPkHashMismatch → permanent', () => {
      assert.ok(isPermanentError({ statusCode: 400, body: 'VapidPkHashMismatch' }));
    });
    it('vapidpkhashmismatch (lower-case) → permanent', () => {
      assert.ok(isPermanentError({ statusCode: 400, body: 'vapidpkhashmismatch' }));
    });
    it('p256dh → permanent', () => {
      assert.ok(isPermanentError({ statusCode: 400, body: 'bad p256dh key' }));
    });
    it('invalid → permanent', () => {
      assert.ok(isPermanentError({ statusCode: 400, body: 'invalid subscription' }));
    });
    it('bad → permanent', () => {
      assert.ok(isPermanentError({ statusCode: 400, body: 'bad auth secret' }));
    });
    it('malformed → permanent', () => {
      assert.ok(isPermanentError({ statusCode: 400, body: 'malformed endpoint' }));
    });
    it('400 with unrelated body → not permanent', () => {
      assert.ok(!isPermanentError({ statusCode: 400, body: 'rate limit exceeded' }));
    });
    it('400 without body → not permanent', () => {
      assert.ok(!isPermanentError({ statusCode: 400 }));
    });
  });

  describe('encryption failure (no HTTP status)', () => {
    it('p256dh bytes error → permanent', () => {
      assert.ok(isPermanentError({ message: 'p256dh must be 65 bytes' }));
    });
    it('auth bytes error → permanent', () => {
      assert.ok(isPermanentError({ message: 'auth must be 16 bytes' }));
    });
    it('generic message without bytes → not permanent', () => {
      assert.ok(!isPermanentError({ message: 'network timeout' }));
    });
  });

  describe('transient errors', () => {
    it('429 (rate limit) → not permanent', () => {
      assert.ok(!isPermanentError({ statusCode: 429 }));
    });
    it('500 → not permanent', () => {
      assert.ok(!isPermanentError({ statusCode: 500 }));
    });
    it('503 → not permanent', () => {
      assert.ok(!isPermanentError({ statusCode: 503 }));
    });
  });
});
