/* ===== POST /api/invoices/void
   Body: { secret, id, reason? }
   ===== */
'use strict';
const { kvGet, kvSet, parseBody, indexEntry, loadIndex, saveIndex, requireFlag, secretOk } = require('./_lib.js');

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

  const raw = await kvGet('invoice:' + id);
  if (!raw) return res.status(404).json({ error: 'Invoice not found' });

  const inv = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (inv.status === 'void') return res.status(400).json({ error: 'Already voided' });

  const now = new Date().toISOString();
  inv.status = 'void'; inv.void_at = now;
  inv.void_reason = body.reason || ''; inv.updated_at = now;

  await kvSet('invoice:' + id, inv);

  const index = await loadIndex();
  const idx = index.findIndex(e => e.id === id);
  if (idx >= 0) index[idx] = indexEntry(inv);
  await saveIndex(index);

  return res.status(200).json({ ok: true, invoice: inv });
};
