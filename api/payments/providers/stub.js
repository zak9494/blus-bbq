/**
 * api/payments/providers/stub.js
 * Development / test payment provider — logs operations instead of charging.
 *
 * This is the default when PAYMENT_PROVIDER is unset. Safe to deploy to
 * production while real provider credentials are not yet available.
 * Never charges a card or makes external network calls.
 */

function ts() { return new Date().toISOString(); }
function fakeId(prefix) { return `${prefix}_stub_${Math.random().toString(36).slice(2, 10)}`; }

async function charge({ amount, currency = 'usd', description = '', metadata = {} }) {
  const transactionId = fakeId('ch');
  console.log(`[payments/stub] charge $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} — "${description}"`, metadata);
  return { ok: true, transactionId, amount, currency, ts: ts() };
}

async function refund({ transactionId, amount }) {
  const refundId = fakeId('re');
  console.log(`[payments/stub] refund ${amount != null ? `$${(amount / 100).toFixed(2)}` : 'full'} for ${transactionId}`);
  return { ok: true, refundId, transactionId, amount: amount != null ? amount : 0, ts: ts() };
}

async function getStatus({ transactionId }) {
  console.log(`[payments/stub] getStatus ${transactionId}`);
  return { ok: true, transactionId, status: 'stub_succeeded', amount: 0, ts: ts() };
}

module.exports = { charge, refund, getStatus };
