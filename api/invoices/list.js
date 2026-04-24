/* ===== GET /api/invoices/list
   Query: from, to, status (csv), service (csv), minAmount, maxAmount,
          search, unpaidOnly, pastDueOnly, limit (max 250), offset
   ===== */
'use strict';
const { requireFlag, loadIndex } = require('./_lib.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const q      = req.query || {};
  const limit  = Math.min(parseInt(q.limit  || '50', 10), 250);
  const offset = Math.max(parseInt(q.offset || '0',  10), 0);

  let index = await loadIndex();

  if (q.from)          index = index.filter(inv => !inv.eventDate || inv.eventDate >= q.from);
  if (q.to)            index = index.filter(inv => !inv.eventDate || inv.eventDate <= q.to);
  if (q.status)        { const s = q.status.split(','); index = index.filter(inv => s.includes(inv.status)); }
  if (q.service)       { const s = q.service.split(','); index = index.filter(inv => s.includes(inv.serviceType)); }
  if (q.minAmount)     index = index.filter(inv => (inv.total || 0) >= parseFloat(q.minAmount));
  if (q.maxAmount)     index = index.filter(inv => (inv.total || 0) <= parseFloat(q.maxAmount));
  if (q.unpaidOnly  === 'true') index = index.filter(inv => (inv.balance || 0) > 0.005 && inv.status !== 'void');
  if (q.pastDueOnly === 'true') index = index.filter(inv => inv.status === 'past_due');
  if (q.search) {
    const s = q.search.toLowerCase();
    index = index.filter(inv =>
      (inv.customerName  || '').toLowerCase().includes(s) ||
      (inv.customerEmail || '').toLowerCase().includes(s) ||
      (inv.invoiceNumber || '').toLowerCase().includes(s)
    );
  }

  return res.status(200).json({ ok: true, total: index.length, offset, limit, invoices: index.slice(offset, offset + limit) });
};
