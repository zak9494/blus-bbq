/* ===== POST /api/invoices/payment
   Body: { secret, id, amount, method, date?, reference?, note? }
   method: check | cash | venmo | zelle | cashapp | paypal | other
   ===== */
'use strict';
const { kvGet, kvSet, parseBody, today, newId, computeStatus, indexEntry, loadIndex, saveIndex, requireFlag, secretOk } = require('./_lib.js');

const VALID_METHODS = new Set(['check','cash','venmo','zelle','cashapp','paypal','other']);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const body = await parseBody(req);
  if (!secretOk(body)) return res.status(401).json({ error: 'Unauthorized' });

  const id = body.id || (req.query && req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const amount = Math.round(parseFloat(body.amount || '0') * 100) / 100;
  if (!(amount > 0)) return res.status(400).json({ error: 'amount must be > 0' });

  const method = body.method || 'other';
  if (!VALID_METHODS.has(method)) return res.status(400).json({ error: 'invalid method: ' + method });

  const raw = await kvGet('invoice:' + id);
  if (!raw) return res.status(404).json({ error: 'Invoice not found' });

  const inv = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (inv.status === 'void') return res.status(400).json({ error: 'Cannot record payment on a voided invoice' });

  const now = new Date().toISOString();
  const payment = {
    id: newId('pay'), amount,
    date:       body.date      || today(),
    method, source: 'manual',
    reference:  body.reference || '',
    note:       body.note      || '',
    recordedAt: now,
  };

  if (!Array.isArray(inv.payments)) inv.payments = [];
  inv.payments.push(payment);
  inv.amountPaid = Math.round(inv.payments.reduce((s, p) => s + (p.amount || 0), 0) * 100) / 100;
  inv.balance    = Math.max(0, Math.round(((inv.total || 0) - inv.amountPaid) * 100) / 100);
  inv.status     = computeStatus(inv);
  inv.updated_at = now;

  await kvSet('invoice:' + id, inv);

  const index = await loadIndex();
  const idx = index.findIndex(e => e.id === id);
  if (idx >= 0) index[idx] = indexEntry(inv);
  await saveIndex(index);

  return res.status(200).json({ ok: true, invoice: inv, payment });
};
