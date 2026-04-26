/* ===== GET /api/invoices/summary?period=month|quarter|ytd|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
   Returns sales summary metrics.
   Backwards-compatible: always returns pastDue, unpaid, charged, paid (used by sales panel).
   New fields: lostDollars, invoiceCount, avgTicket.
   ===== */
'use strict';
const { requireFlag, loadIndex, kvGet } = require('./_lib.js');

function startOf(period) {
  const now = new Date();
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
  }
  if (period === 'ytd') {
    return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const q = req.query || {};
  const period = q.period || 'month';

  let from = q.from || null;
  let to   = q.to   || null;

  if (period !== 'custom') {
    from = startOf(period);
    to   = new Date().toISOString().slice(0, 10);
  }

  const index = await loadIndex();

  // Filter by issue date (fall back to event date) within period
  const inRange = (inv) => {
    const d = inv.issueDate || inv.eventDate;
    if (!d) return true;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  };

  const relevant = index.filter(inRange);

  let charged    = 0;
  let paid       = 0;
  let unpaid     = 0;
  let pastDue    = 0;
  let invoiceCount = 0;

  for (const inv of relevant) {
    if (inv.status === 'void') continue;
    invoiceCount++;
    charged += (inv.total || 0);
    paid    += (inv.amountPaid || 0);
    if ((inv.balance || 0) > 0.005) unpaid += (inv.balance || 0);
    if (inv.status === 'past_due')  pastDue += (inv.balance || 0);
  }

  const avgTicket = invoiceCount > 0 ? charged / invoiceCount : 0;

  // lostDollars: sum of quote totals on declined/archived inquiries in range.
  // KV index records use snake_case (event_date, quote_total, updated_at). Accept
  // camelCase too in case older code paths wrote either shape.
  let lostDollars = 0;
  try {
    const inqRaw = await kvGet('inquiries:index');
    if (inqRaw) {
      const inqIndex = typeof inqRaw === 'string' ? JSON.parse(inqRaw) : inqRaw;
      for (const inq of (inqIndex || [])) {
        if (!['declined', 'archived'].includes(inq.status)) continue;
        const d = inq.event_date || inq.eventDate || inq.updated_at || inq.created_at;
        if (from && d && d.slice(0, 10) < from) continue;
        if (to   && d && d.slice(0, 10) > to)   continue;
        const qt = inq.quote_total || inq.quoteTotal;
        if (qt) lostDollars += Number(qt) || 0;
      }
    }
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    period,
    from,
    to,
    charged:      Math.round(charged      * 100) / 100,
    paid:         Math.round(paid         * 100) / 100,
    unpaid:       Math.round(unpaid       * 100) / 100,
    pastDue:      Math.round(pastDue      * 100) / 100,
    lostDollars:  Math.round(lostDollars  * 100) / 100,
    invoiceCount,
    avgTicket:    Math.round(avgTicket    * 100) / 100,
  });
};
