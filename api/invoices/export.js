/* ===== GET /api/invoices/export
   Query params: same as list (from, to, status, service, minAmount, maxAmount,
                 search, unpaidOnly, pastDueOnly)
   Returns CSV download.
   ===== */
'use strict';
const { requireFlag, loadIndex, kvGet } = require('./_lib.js');

const CSV_COLS = [
  'Invoice #', 'Customer Name', 'Customer Email', 'Phone',
  'Event Date', 'Issue Date', 'Due Date', 'Service Type',
  'Total', 'Amount Paid', 'Balance', 'Status', 'Created At',
];

function esc(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const q = req.query || {};

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

  const rows = [CSV_COLS.join(',')];
  for (const entry of index) {
    let inv = entry;
    if (entry.id) {
      const full = await kvGet('invoice:' + entry.id).catch(() => null);
      if (full) inv = typeof full === 'string' ? JSON.parse(full) : full;
    }
    rows.push([
      esc(inv.invoiceNumber),
      esc(inv.customerName),
      esc(inv.customerEmail),
      esc(inv.customerPhone),
      esc(inv.eventDate),
      esc(inv.issueDate),
      esc(inv.dueDate),
      esc(inv.serviceType),
      esc((inv.total || 0).toFixed(2)),
      esc((inv.amountPaid || 0).toFixed(2)),
      esc((inv.balance || 0).toFixed(2)),
      esc(inv.status),
      esc(inv.created_at ? inv.created_at.slice(0, 10) : ''),
    ].join(','));
  }

  const csv = rows.join('\r\n');
  const filename = 'invoices-' + new Date().toISOString().slice(0, 10) + '.csv';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
};
