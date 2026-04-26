/* ===== GET /api/invoices/pdf?id=...
   Returns a PDF of the invoice. Pure-Node PDF generation; no external PDF deps.
   ===== */
'use strict';
const { kvGet, requireFlag } = require('./_lib.js');

/* ---------- tiny PDF builder ---------- */
function buildPdf(inv) {
  const objs = [];
  let oid = 0;

  function obj(content) {
    oid++;
    objs.push({ id: oid, content });
    return oid;
  }

  // catalog
  const catalogId = obj('<< /Type /Catalog /Pages 2 0 R >>');
  // pages (placeholder — will be patched)
  const pagesId = obj('');
  // font
  const fontId = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBoldId = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  /* ---- build page content stream ---- */
  const lines = [];
  const W = 612, H = 792;
  const ml = 60, mr = W - 60;

  function text(x, y, s, size, bold) {
    const fn = bold ? 'F2' : 'F1';
    lines.push(`BT /${fn} ${size} Tf ${x} ${H - y} Td (${pdfStr(s)}) Tj ET`);
  }
  function line(x1, y1, x2, y2) {
    lines.push(`${x1} ${H - y1} m ${x2} ${H - y2} l S`);
  }
  function rect(x, y, w, h, fill) {
    lines.push(`${x} ${H - y - h} ${w} ${h} re ${fill ? 'f' : 'S'}`);
  }
  function color(r, g, b) {
    lines.push(`${(r/255).toFixed(3)} ${(g/255).toFixed(3)} ${(b/255).toFixed(3)} rg`);
  }
  function colorStroke(r, g, b) {
    lines.push(`${(r/255).toFixed(3)} ${(g/255).toFixed(3)} ${(b/255).toFixed(3)} RG`);
  }

  // header bar
  color(30, 58, 95);
  rect(0, 0, W, 80, true);
  color(255, 255, 255);
  text(ml, 30, "Blu's Barbeque Catering", 18, true);
  text(ml, 52, 'info@blusbarbeque.com', 10, false);
  color(0, 0, 0);

  // Invoice title + number
  text(ml, 110, 'INVOICE', 22, true);
  text(mr - 140, 110, inv.invoiceNumber || '', 14, false);

  // status badge
  const statusColors = {
    draft: [100, 100, 100], sent: [37, 99, 235], partial: [217, 119, 6],
    paid: [22, 163, 74], past_due: [220, 38, 38], void: [150, 150, 150],
    refunded: [124, 58, 237],
  };
  const sc = statusColors[inv.status] || [100, 100, 100];
  color(...sc);
  rect(mr - 140, 118, 80, 18, true);
  color(255, 255, 255);
  text(mr - 136, 132, (inv.status || '').toUpperCase(), 9, true);
  color(0, 0, 0);

  // Bill to / details columns
  let y = 155;
  text(ml, y, 'BILL TO', 8, true);
  text(320, y, 'DETAILS', 8, true);
  y += 14;
  text(ml, y, inv.customerName || '', 11, true);
  text(320, y, 'Issue Date:', 9, false);
  text(420, y, inv.issueDate || '', 9, false);
  y += 14;
  text(ml, y, inv.customerEmail || '', 10, false);
  text(320, y, 'Due Date:', 9, false);
  text(420, y, inv.dueDate || 'N/A', 9, false);
  y += 14;
  if (inv.customerPhone) { text(ml, y, inv.customerPhone, 10, false); }
  text(320, y, 'Event Date:', 9, false);
  text(420, y, inv.eventDate || 'N/A', 9, false);
  y += 14;
  text(320, y, 'Service Type:', 9, false);
  text(420, y, inv.serviceType || '', 9, false);

  // Line items table header
  y += 24;
  color(245, 247, 250);
  rect(ml, y - 2, mr - ml, 18, true);
  color(0, 0, 0);
  colorStroke(200, 200, 200);
  text(ml + 4, y + 10, 'Description', 9, true);
  text(380, y + 10, 'Qty', 9, true);
  text(430, y + 10, 'Unit Price', 9, true);
  text(510, y + 10, 'Amount', 9, true);
  y += 20;

  const items = Array.isArray(inv.lineItems) ? inv.lineItems : [];
  for (const item of items) {
    line(ml, y, mr, y);
    text(ml + 4, y + 11, item.description || '', 9, false);
    text(380, y + 11, String(item.qty || 1), 9, false);
    text(430, y + 11, '$' + Number(item.unitPrice || 0).toFixed(2), 9, false);
    text(510, y + 11, '$' + Number(item.amount || 0).toFixed(2), 9, false);
    y += 18;
  }
  if (items.length === 0) {
    line(ml, y, mr, y);
    text(ml + 4, y + 11, '(no line items)', 9, false);
    y += 18;
  }

  // Totals
  line(ml, y, mr, y);
  y += 12;
  text(430, y, 'Subtotal:', 9, false);
  text(510, y, '$' + (inv.subtotal || 0).toFixed(2), 9, false);
  y += 14;
  if (inv.taxAmount > 0) {
    text(430, y, `Tax (${(inv.taxRate || 0).toFixed(2)}%):`, 9, false);
    text(510, y, '$' + (inv.taxAmount || 0).toFixed(2), 9, false);
    y += 14;
  }
  color(30, 58, 95);
  text(430, y, 'Total:', 11, true);
  text(510, y, '$' + (inv.total || 0).toFixed(2), 11, true);
  color(0, 0, 0);
  y += 14;
  text(430, y, 'Amount Paid:', 9, false);
  text(510, y, '$' + (inv.amountPaid || 0).toFixed(2), 9, false);
  y += 14;
  text(430, y, 'Balance Due:', 11, true);
  text(510, y, '$' + (inv.balance || 0).toFixed(2), 11, true);

  // Notes
  if (inv.notes) {
    y += 28;
    line(ml, y, mr, y);
    y += 12;
    text(ml, y, 'Notes:', 9, true);
    y += 13;
    const words = inv.notes.split(' ');
    let ln = '';
    for (const w of words) {
      if ((ln + w).length > 85) { text(ml, y, ln.trim(), 9, false); y += 12; ln = ''; }
      ln += w + ' ';
    }
    if (ln.trim()) text(ml, y, ln.trim(), 9, false);
  }

  // footer
  color(150, 150, 150);
  text(ml, H - 40, "Thank you for choosing Blu's Barbeque Catering!", 9, false);
  color(0, 0, 0);

  const stream = lines.join('\n');
  const streamId = obj(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);

  // page
  const pageId = obj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`);

  // patch pages
  objs[pagesId - 1].content = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;

  /* ---- assemble ---- */
  const parts = ['%PDF-1.4\n'];
  const offsets = [];

  for (const o of objs) {
    offsets.push(parts.join('').length);
    parts.push(`${o.id} 0 obj\n${o.content}\nendobj\n`);
  }

  const xrefOffset = parts.join('').length;
  parts.push('xref\n');
  parts.push(`0 ${objs.length + 1}\n`);
  parts.push('0000000000 65535 f \n');
  for (const off of offsets) {
    parts.push(String(off).padStart(10, '0') + ' 00000 n \n');
  }
  parts.push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\n`);
  parts.push(`startxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(parts.join(''), 'binary');
}

function pdfStr(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  const raw = await kvGet('invoice:' + id);
  if (!raw) return res.status(404).json({ error: 'Invoice not found' });

  const inv = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const pdf = buildPdf(inv);

  const filename = (inv.invoiceNumber || id) + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  return res.status(200).send(pdf);
};
