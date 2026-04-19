'use strict';
/**
 * Pure-Node.js PDF generator for Blu's BBQ catering quotes.
 * No external dependencies — uses only built-in Buffer.
 * Produces PDF 1.4, US Letter, Helvetica built-in fonts.
 */

const PW = 612, PH = 792; // US Letter @ 72pt/inch
const ML = 54;            // left margin (0.75 in)

/** Escape a string for use inside PDF literal string ( ... ) */
function esc(str) {
  return String(str)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generate a PDF quote document.
 * @param {object} q            - quote object (line_items, food_subtotal, …)
 * @param {string} customerName - e.g. "Bob Billy"
 * @returns {Buffer}
 */
function generateQuotePDF(q, customerName) {
  const cmds = [];

  /** Place text at absolute (x, y from top) */
  function txt(x, y, str, font, size) {
    cmds.push('BT /' + font + ' ' + size + ' Tf ' + x + ' ' + (PH - y) + ' Td (' + esc(str) + ') Tj ET');
  }

  /** Draw a horizontal line */
  function hline(y, x1, x2, lw) {
    if (x1 === undefined) x1 = ML;
    if (x2 === undefined) x2 = PW - ML;
    if (lw === undefined) lw = 0.5;
    cmds.push(lw + ' w ' + x1 + ' ' + (PH - y) + ' m ' + x2 + ' ' + (PH - y) + ' l S');
  }

  // ── Header ──────────────────────────────────────────────────────────
  txt(ML, 52, "Blu's Barbeque", 'F2', 22);
  txt(ML, 75, 'Dallas, TX  |  info@blusbarbeque.com', 'F1', 10);
  hline(84, ML, PW - ML, 1.5);

  txt(ML, 102, 'CATERING QUOTE', 'F2', 14);
  let y = 102;
  if (customerName) {
    y += 18;
    txt(ML, y, 'Prepared for: ' + customerName, 'F1', 11);
  }
  y += 28;

  // ── Line items ──────────────────────────────────────────────────────
  // Column x positions: name@54, qty@360, unit@410, sub@496
  txt(ML,  y, 'Item',       'F2', 9);
  txt(360, y, 'Qty',        'F2', 9);
  txt(410, y, 'Unit Price', 'F2', 9);
  txt(496, y, 'Subtotal',   'F2', 9);
  y += 5;
  hline(y);
  y += 15;

  for (var i = 0; i < (q.line_items || []).length; i++) {
    var li = q.line_items[i];
    txt(ML,  y, String(li.name || ''),   'F1', 10);
    txt(364, y, String(li.qty  || 0),    'F1', 10);
    txt(410, y, '$' + Number(li.unit_price || 0).toFixed(2), 'F1', 10);
    txt(496, y, '$' + Number(li.subtotal  || 0).toFixed(2), 'F1', 10);
    y += 16;
  }

  hline(y);
  y += 15;

  // ── Totals block ────────────────────────────────────────────────────
  var TL = 350, TR = 496;

  function totRow(label, amount, bold) {
    var f = bold ? 'F2' : 'F1';
    var s = bold ? 13  : 10;
    txt(TL, y, label,  f, s);
    txt(TR, y, amount, f, s);
    y += bold ? 18 : 16;
  }

  totRow('Food Subtotal', '$' + Number(q.food_subtotal || 0).toFixed(2), false);

  if (q.service_charge_pct) {
    totRow('Service Charge (' + q.service_charge_pct + '%)',
           '$' + Number(q.service_charge || 0).toFixed(2), false);
  }
  if (q.delivery_fee) {
    totRow('Delivery Fee', '$' + Number(q.delivery_fee || 0).toFixed(2), false);
  }

  if (q.tax_exempt) {
    totRow('TX Sales Tax', 'Exempt', false);
  } else {
    var tax = q.sales_tax !== undefined
      ? q.sales_tax
      : Math.round(Number(q.food_subtotal || 0) * 0.0825 * 100) / 100;
    totRow('TX Sales Tax (8.25%)', '$' + Number(tax).toFixed(2), false);
  }

  y += 2;
  hline(y, TL - 6, PW - ML);
  y += 16;
  totRow('TOTAL', '$' + Number(q.total || 0).toFixed(2), true);

  // ── Notes ───────────────────────────────────────────────────────────
  if (q.notes) {
    y += 18;
    txt(ML, y, 'Notes:', 'F2', 10);
    y += 14;
    var words = q.notes.split(' ');
    var noteL = '';
    for (var wi = 0; wi < words.length; wi++) {
      var candidate = noteL ? noteL + ' ' + words[wi] : words[wi];
      if (candidate.length > 92) {
        txt(ML, y, noteL, 'F1', 10);
        y += 14;
        noteL = words[wi];
      } else {
        noteL = candidate;
      }
    }
    if (noteL) txt(ML, y, noteL, 'F1', 10);
  }

  // ── Footer ──────────────────────────────────────────────────────────
  hline(762, ML, PW - ML, 0.5);
  txt(ML, 775, "This quote is valid for 30 days. Thank you for choosing Blu's Barbeque!", 'F3', 8);

  // ── Assemble PDF ────────────────────────────────────────────────────
  var streamSrc = cmds.join('\n');
  var streamLen = Buffer.byteLength(streamSrc, 'binary');

  var resources =
    '<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>' +
    '/F2<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>' +
    '/F3<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Oblique>>>>>>';

  var o1 = '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n';
  var o2 = '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n';
  var o3 = '3 0 obj\n<</Type/Page/Parent 2 0 R/Resources ' + resources +
           '/MediaBox[0 0 ' + PW + ' ' + PH + ']/Contents 4 0 R>>\nendobj\n';
  var o4 = '4 0 obj\n<</Length ' + streamLen + '>>\nstream\n' + streamSrc + '\nendstream\nendobj\n';

  var header = '%PDF-1.4\n';
  var objs   = [o1, o2, o3, o4];
  var offsets = [];
  var pos = Buffer.byteLength(header, 'binary');
  for (var oi = 0; oi < objs.length; oi++) {
    offsets.push(pos);
    pos += Buffer.byteLength(objs[oi], 'binary');
  }

  var xrefOff = pos;
  var xref = 'xref\n0 5\n0000000000 65535 f \n';
  for (var xi = 0; xi < offsets.length; xi++) {
    xref += String(offsets[xi]).padStart(10, '0') + ' 00000 n \n';
  }
  var trailer = 'trailer\n<</Size 5/Root 1 0 R>>\nstartxref\n' + xrefOff + '\n%%EOF\n';

  return Buffer.concat(
    [header].concat(objs).concat([xref, trailer]).map(function(p) {
      return Buffer.from(p, 'binary');
    })
  );
}

module.exports = { generateQuotePDF };
