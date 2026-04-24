/* ===== POST /api/invoices/update  (also accepts PATCH) ===== */
'use strict';
const { kvGet, kvSet, parseBody, computeStatus, indexEntry, loadIndex, saveIndex, requireFlag, secretOk } = require('./_lib.js');

const UPDATABLE = ['customerName','customerEmail','customerPhone','eventDate','issueDate','dueDate',
                   'serviceType','lineItems','subtotal','taxRate','taxAmount','total','notes'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const body = await parseBody(req);
  if (!secretOk(body)) return res.status(401).json({ error: 'Unauthorized' });

  const id = body.id || (req.query && req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const raw = await kvGet('invoice:' + id);
  if (!raw) return res.status(404).json({ error: 'Invoice not found' });

  const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (existing.status === 'void') return res.status(400).json({ error: 'Cannot update a voided invoice' });

  const updated = { ...existing, updated_at: new Date().toISOString() };
  for (const f of UPDATABLE) { if (body[f] !== undefined) updated[f] = body[f]; }

  updated.balance = Math.max(0, Math.round(((updated.total || 0) - (updated.amountPaid || 0)) * 100) / 100);
  updated.status  = computeStatus(updated);

  await kvSet('invoice:' + id, updated);

  const index = await loadIndex();
  const idx = index.findIndex(e => e.id === id);
  if (idx >= 0) index[idx] = indexEntry(updated); else index.unshift(indexEntry(updated));
  await saveIndex(index);

  return res.status(200).json({ ok: true, invoice: updated });
};
