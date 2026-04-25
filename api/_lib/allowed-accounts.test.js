'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('allowed-accounts', () => {
  let saved;

  beforeEach(() => { saved = process.env.ALLOWED_GMAIL_ACCOUNTS; });
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_GMAIL_ACCOUNTS;
    else process.env.ALLOWED_GMAIL_ACCOUNTS = saved;
    // Re-require is not needed — functions call process.env at runtime.
  });

  function load() {
    // Clear the require cache so env changes take effect.
    delete require.cache[require.resolve('./allowed-accounts')];
    return require('./allowed-accounts');
  }

  describe('getAllowedAccounts', () => {
    it('defaults to info@blusbarbeque.com when env is unset', () => {
      delete process.env.ALLOWED_GMAIL_ACCOUNTS;
      const { getAllowedAccounts } = load();
      assert.deepStrictEqual(getAllowedAccounts(), ['info@blusbarbeque.com']);
    });

    it('returns a single entry from env', () => {
      process.env.ALLOWED_GMAIL_ACCOUNTS = 'tenant@example.com';
      const { getAllowedAccounts } = load();
      assert.deepStrictEqual(getAllowedAccounts(), ['tenant@example.com']);
    });

    it('splits comma-separated entries and trims whitespace', () => {
      process.env.ALLOWED_GMAIL_ACCOUNTS = 'a@x.com , B@X.COM , c@x.com';
      const { getAllowedAccounts } = load();
      assert.deepStrictEqual(getAllowedAccounts(), ['a@x.com', 'b@x.com', 'c@x.com']);
    });

    it('lowercases all entries', () => {
      process.env.ALLOWED_GMAIL_ACCOUNTS = 'UPPER@EXAMPLE.COM';
      const { getAllowedAccounts } = load();
      assert.deepStrictEqual(getAllowedAccounts(), ['upper@example.com']);
    });

    it('filters out empty entries from trailing commas', () => {
      process.env.ALLOWED_GMAIL_ACCOUNTS = 'a@x.com,';
      const { getAllowedAccounts } = load();
      assert.deepStrictEqual(getAllowedAccounts(), ['a@x.com']);
    });
  });

  describe('isAllowedAccount', () => {
    beforeEach(() => { delete process.env.ALLOWED_GMAIL_ACCOUNTS; });

    it('returns true for the default account', () => {
      const { isAllowedAccount } = load();
      assert.ok(isAllowedAccount('info@blusbarbeque.com'));
    });

    it('is case-insensitive', () => {
      const { isAllowedAccount } = load();
      assert.ok(isAllowedAccount('INFO@BLUSBARBEQUE.COM'));
    });

    it('returns false for an unlisted account', () => {
      const { isAllowedAccount } = load();
      assert.ok(!isAllowedAccount('attacker@evil.com'));
    });

    it('returns false for empty string', () => {
      const { isAllowedAccount } = load();
      assert.ok(!isAllowedAccount(''));
    });

    it('returns false for null/undefined', () => {
      const { isAllowedAccount } = load();
      assert.ok(!isAllowedAccount(null));
      assert.ok(!isAllowedAccount(undefined));
    });

    it('allows a custom account set via env', () => {
      process.env.ALLOWED_GMAIL_ACCOUNTS = 'tenant@example.com';
      const { isAllowedAccount } = load();
      assert.ok(isAllowedAccount('tenant@example.com'));
      assert.ok(!isAllowedAccount('info@blusbarbeque.com'));
    });

    it('allows multiple accounts from env', () => {
      process.env.ALLOWED_GMAIL_ACCOUNTS = 'a@x.com,b@x.com';
      const { isAllowedAccount } = load();
      assert.ok(isAllowedAccount('a@x.com'));
      assert.ok(isAllowedAccount('b@x.com'));
      assert.ok(!isAllowedAccount('c@x.com'));
    });
  });
});
