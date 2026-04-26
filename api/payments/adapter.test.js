'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

// ── Helpers ────────────────────────────────────────────────────────────────
let savedProvider;
beforeEach(() => { savedProvider = process.env.PAYMENT_PROVIDER; delete process.env.PAYMENT_PROVIDER; });
afterEach(() => {
  if (savedProvider !== undefined) process.env.PAYMENT_PROVIDER = savedProvider;
  else delete process.env.PAYMENT_PROVIDER;
  // Bust the adapter require cache so env var changes take effect
  delete require.cache[require.resolve(path.join(__dirname, 'adapter.js'))];
});

function freshAdapter() {
  delete require.cache[require.resolve(path.join(__dirname, 'adapter.js'))];
  return require(path.join(__dirname, 'adapter.js'));
}

// ── Adapter selection ──────────────────────────────────────────────────────
describe('payments/adapter — provider selection', () => {
  it('defaults to stub when PAYMENT_PROVIDER is unset', () => {
    const { getProvider } = freshAdapter();
    const provider = getProvider();
    assert.ok(typeof provider.charge === 'function');
    assert.ok(typeof provider.refund === 'function');
    assert.ok(typeof provider.getStatus === 'function');
  });

  it('selects stub when PAYMENT_PROVIDER=stub', () => {
    process.env.PAYMENT_PROVIDER = 'stub';
    const { getProvider } = freshAdapter();
    const provider = getProvider();
    assert.ok(typeof provider.charge === 'function');
  });

  it('selects stripe when PAYMENT_PROVIDER=stripe', () => {
    process.env.PAYMENT_PROVIDER = 'stripe';
    const { getProvider } = freshAdapter();
    const provider = getProvider();
    assert.ok(typeof provider.charge === 'function');
  });

  it('selects square when PAYMENT_PROVIDER=square', () => {
    process.env.PAYMENT_PROVIDER = 'square';
    const { getProvider } = freshAdapter();
    const provider = getProvider();
    assert.ok(typeof provider.charge === 'function');
  });

  it('throws for unknown provider name', () => {
    process.env.PAYMENT_PROVIDER = 'paypal';
    const { getProvider } = freshAdapter();
    assert.throws(() => getProvider(), /Unknown PAYMENT_PROVIDER/);
  });

  it('is case-insensitive (STRIPE → stripe)', () => {
    process.env.PAYMENT_PROVIDER = 'STRIPE';
    const { getProvider } = freshAdapter();
    assert.doesNotThrow(() => getProvider());
  });
});

// ── Stub provider — interface contract ─────────────────────────────────────
describe('payments/providers/stub — charge', () => {
  const stub = require(path.join(__dirname, 'providers/stub.js'));

  it('returns ok=true with transactionId and amount', async () => {
    const r = await stub.charge({ amount: 5000, currency: 'usd', description: 'Test' });
    assert.equal(r.ok, true);
    assert.ok(r.transactionId.startsWith('ch_stub_'));
    assert.equal(r.amount, 5000);
    assert.equal(r.currency, 'usd');
    assert.ok(r.ts);
  });

  it('defaults currency to usd when omitted', async () => {
    const r = await stub.charge({ amount: 1000 });
    assert.equal(r.currency, 'usd');
  });

  it('each charge returns a unique transactionId', async () => {
    const [a, b] = await Promise.all([
      stub.charge({ amount: 100 }),
      stub.charge({ amount: 200 }),
    ]);
    assert.notEqual(a.transactionId, b.transactionId);
  });
});

describe('payments/providers/stub — refund', () => {
  const stub = require(path.join(__dirname, 'providers/stub.js'));

  it('returns ok=true with refundId', async () => {
    const r = await stub.refund({ transactionId: 'ch_stub_abc', amount: 500 });
    assert.equal(r.ok, true);
    assert.ok(r.refundId.startsWith('re_stub_'));
    assert.equal(r.transactionId, 'ch_stub_abc');
  });

  it('accepts full refund (no amount)', async () => {
    const r = await stub.refund({ transactionId: 'ch_stub_xyz' });
    assert.equal(r.ok, true);
  });
});

describe('payments/providers/stub — getStatus', () => {
  const stub = require(path.join(__dirname, 'providers/stub.js'));

  it('returns ok=true with status', async () => {
    const r = await stub.getStatus({ transactionId: 'ch_stub_abc' });
    assert.equal(r.ok, true);
    assert.equal(r.transactionId, 'ch_stub_abc');
    assert.ok(r.status);
    assert.ok(r.ts);
  });
});
