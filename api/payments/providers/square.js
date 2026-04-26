/**
 * api/payments/providers/square.js
 * Square payment provider — requires SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID env vars.
 *
 * Uses native https.request (no Square SDK dependency).
 * Targets the Square Payments API v2.
 * All amounts are in cents (integer); Square uses the same unit for USD.
 *
 * NEVER log or store raw card data.
 */

const https = require('https');
const crypto = require('crypto');

const BASE = 'connect.squareup.com';

function squareRequest(method, path, body) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN env var not set');

  const bodyStr = body ? JSON.stringify(body) : '';

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE,
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function charge({ amount, currency = 'USD', description = '', metadata = {} }) {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) throw new Error('SQUARE_LOCATION_ID env var not set');

  const body = {
    idempotency_key: crypto.randomUUID(),
    amount_money: { amount, currency: currency.toUpperCase() },
    note: description,
    reference_id: metadata.threadId || undefined,
    source_id: 'EXTERNAL',
  };

  const r = await squareRequest('POST', '/v2/payments', body);
  if (r.status >= 300) throw new Error(`Square charge failed ${r.status}: ${JSON.stringify(r.body)}`);

  const payment = r.body.payment;
  return {
    ok: true,
    transactionId: payment.id,
    amount: payment.amount_money.amount,
    currency: payment.amount_money.currency,
    ts: new Date().toISOString(),
  };
}

async function refund({ transactionId, amount }) {
  const body = {
    idempotency_key: crypto.randomUUID(),
    payment_id: transactionId,
    ...(amount != null ? { amount_money: { amount, currency: 'USD' } } : {}),
  };

  const r = await squareRequest('POST', '/v2/refunds', body);
  if (r.status >= 300) throw new Error(`Square refund failed ${r.status}: ${JSON.stringify(r.body)}`);

  const refund = r.body.refund;
  return {
    ok: true,
    refundId: refund.id,
    transactionId,
    amount: refund.amount_money ? refund.amount_money.amount : 0,
    ts: new Date().toISOString(),
  };
}

async function getStatus({ transactionId }) {
  const r = await squareRequest('GET', `/v2/payments/${encodeURIComponent(transactionId)}`);
  if (r.status >= 300) throw new Error(`Square getStatus failed ${r.status}: ${JSON.stringify(r.body)}`);

  const payment = r.body.payment;
  return {
    ok: true,
    transactionId: payment.id,
    status: payment.status,
    amount: payment.amount_money ? payment.amount_money.amount : 0,
    ts: new Date().toISOString(),
  };
}

module.exports = { charge, refund, getStatus };
