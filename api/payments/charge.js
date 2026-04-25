/**
 * POST /api/payments/charge
 * Provider-agnostic charge endpoint — gated on payment_links_v1 flag.
 *
 * Delegates to the active provider (PAYMENT_PROVIDER=stripe|square|stub).
 * Stub mode (default) logs instead of charging — safe to deploy before
 * Stripe/Square credentials are available.
 *
 * Body: { amount (cents, integer), currency?, description?, threadId?, metadata? }
 * Response: { ok, transactionId, amount, currency, mode, ts }
 *
 * Secret gate: ?secret=GMAIL_READ_SECRET or X-Secret header.
 * NEVER pass raw card data to this endpoint — use provider-hosted tokenization.
 */

const { getProvider } = require('./adapter');
const { getFlag } = require('../_lib/flags');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) return res.status(500).json({ error: 'GMAIL_READ_SECRET env var not configured' });
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const enabled = await getFlag('payment_links_v1');
  if (!enabled) return res.status(403).json({ error: 'payment_links_v1 flag is OFF' });

  const { amount, currency = 'usd', description = '', threadId, metadata = {} } = req.body || {};
  if (!amount || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive integer (cents)' });
  }

  const mode = (process.env.PAYMENT_PROVIDER || 'stub').toLowerCase();
  let provider;
  try { provider = getProvider(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  let result;
  try {
    result = await provider.charge({
      amount,
      currency,
      description,
      metadata: { ...metadata, ...(threadId ? { threadId } : {}) },
    });
  } catch (e) {
    return res.status(502).json({ error: 'Payment provider error', detail: e.message });
  }

  return res.status(200).json({ ...result, mode });
};
