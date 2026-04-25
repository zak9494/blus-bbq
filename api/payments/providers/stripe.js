/**
 * api/payments/providers/stripe.js
 * Stripe payment provider — requires STRIPE_SECRET_KEY env var.
 *
 * Uses native https.request (no Stripe SDK dependency) to keep the
 * Vercel bundle lean. Only the endpoints needed for Blu's BBQ flow
 * are implemented: charge (PaymentIntent), refund, and status check.
 *
 * NEVER log or store raw card data. All amounts are in cents (integer).
 */

const https = require('https');

const BASE = 'api.stripe.com';

function stripeRequest(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var not set');

  const body = params ? new URLSearchParams(params).toString() : '';
  const auth = Buffer.from(`${key}:`).toString('base64');

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE,
      path,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
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
    if (body) req.write(body);
    req.end();
  });
}

async function charge({ amount, currency = 'usd', description = '', metadata = {} }) {
  const params = {
    amount: String(amount),
    currency,
    description,
    confirm: 'true',
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
  };
  Object.entries(metadata).forEach(([k, v]) => { params[`metadata[${k}]`] = String(v); });

  const r = await stripeRequest('POST', '/v1/payment_intents', params);
  if (r.status >= 300) throw new Error(`Stripe charge failed ${r.status}: ${JSON.stringify(r.body)}`);

  return {
    ok: true,
    transactionId: r.body.id,
    amount: r.body.amount,
    currency: r.body.currency,
    ts: new Date().toISOString(),
  };
}

async function refund({ transactionId, amount }) {
  const params = { payment_intent: transactionId };
  if (amount != null) params.amount = String(amount);

  const r = await stripeRequest('POST', '/v1/refunds', params);
  if (r.status >= 300) throw new Error(`Stripe refund failed ${r.status}: ${JSON.stringify(r.body)}`);

  return {
    ok: true,
    refundId: r.body.id,
    transactionId,
    amount: r.body.amount,
    ts: new Date().toISOString(),
  };
}

async function getStatus({ transactionId }) {
  const r = await stripeRequest('GET', `/v1/payment_intents/${encodeURIComponent(transactionId)}`);
  if (r.status >= 300) throw new Error(`Stripe getStatus failed ${r.status}: ${JSON.stringify(r.body)}`);

  return {
    ok: true,
    transactionId: r.body.id,
    status: r.body.status,
    amount: r.body.amount,
    ts: new Date().toISOString(),
  };
}

module.exports = { charge, refund, getStatus };
