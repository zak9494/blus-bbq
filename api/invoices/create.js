/* ===== POST /api/invoices/create ===== */
'use strict';
const { kvGet, kvSet, kvIncr, parseBody, today, newId,
        computeStatus, indexEntry, loadIndex, saveIndex, requireFlag, secretOk } = require('./_lib.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const body = await parseBody(req);
  if (!secretOk(body)) return res.status(401).json({ error: 'Unauthorized' });

  const now    = new Date().toISOString();
  const id     = newId('inv');
  const num    = await kvIncr('invoices:counter');
  const invoiceNumber = 'INV-' + new Date().getFullYear() + '-' + String(num).padStart(4, '0');

  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  const subtotal  = Math.round(Number(body.subtotal  || 0) * 100) / 100;
  const taxAmount = Math.round(Number(body.taxAmount || 0) * 100) / 100;
  const total     = Math.round(Number(body.total !== undefined ? body.total : subtotal + taxAmount) * 100) / 100;

  const inv = {
    id, invoiceNumber,
    threadId:      body.threadId      || null,
    customerId:    body.customerEmail || body.customerId || '',
    customerName:  body.customerName  || '',
    customerEmail: body.customerEmail || '',
    customerPhone: body.customerPhone || '',
    eventDate:     body.eventDate     || null,
    issueDate:     body.issueDate     || today(),
    dueDate:       body.dueDate       || null,
    serviceType:   body.serviceType   || 'pickup',
    lineItems, subtotal,
    taxRate:       Number(body.taxRate || 0),
    taxAmount, total,
    amountPaid: 0, balance: total,
    status:    'draft',
    payments:  [],
    notes:     body.notes || '',
    source:    'manual',
    created_at: now, updated_at: now,
  };

  inv.status = computeStatus(inv);
  await kvSet('invoice:' + id, inv);

  const index = await loadIndex();
  index.unshift(indexEntry(inv));
  await saveIndex(index);

  if (inv.customerEmail) {
    try {
      const custKey = 'invoices:by-customer:' + inv.customerEmail;
      const raw = await kvGet(custKey);
      let ids = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      if (!Array.isArray(ids)) ids = [];
      ids.unshift(id);
      await kvSet(custKey, ids.slice(0, 200));
    } catch {}
  }

  return res.status(200).json({ ok: true, invoice: inv });
};
