/**
 * api/payments/adapter.js
 * Provider-agnostic payment adapter for Blu's BBQ.
 *
 * Selects the active provider at runtime via PAYMENT_PROVIDER env var.
 * Valid values: 'stripe' | 'square' | 'stub'  (defaults to 'stub' when unset)
 *
 * Every provider must implement the same interface:
 *   charge(opts)    → { ok, transactionId, amount, currency, ts }
 *   refund(opts)    → { ok, refundId, transactionId, amount, ts }
 *   getStatus(opts) → { ok, transactionId, status, amount, ts }
 *
 * opts for charge:  { amount (cents), currency, description, metadata? }
 * opts for refund:  { transactionId, amount? (cents, defaults to full) }
 * opts for status:  { transactionId }
 *
 * NO card numbers should ever pass through here — use provider-hosted checkout
 * links or tokenized payment methods only.
 */

const PROVIDERS = {
  stripe: () => require('./providers/stripe'),
  square: () => require('./providers/square'),
  stub:   () => require('./providers/stub'),
};

function getProvider() {
  const name = (process.env.PAYMENT_PROVIDER || 'stub').toLowerCase();
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(`Unknown PAYMENT_PROVIDER "${name}". Valid values: stripe, square, stub.`);
  }
  return factory();
}

module.exports = { getProvider };
