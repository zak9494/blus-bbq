/* ===== INVOICE SUMMARY ENDPOINT
   GET /api/invoices/summary?period=this_month|ytd|last_week|last_month
   GET /api/invoices/summary?from=YYYY-MM-DD&to=YYYY-MM-DD

   Best-effort roll-up from KV inquiry/quote data:
     charged = sum of quote.total for booked/completed inquiries in range
     paid    = sum of quote.total where rec.paid === true
     pastDue = 0 (until payment provider integration)
     unpaid  = charged - paid

   Gated: returns 403 when invoice_manager_v1 flag is OFF.
   ===== */
'use strict';
const https = require('https');
const { getFlag } = require('../_lib/flags.js');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function resolveDateRange(period, fromParam, toParam) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  if (fromParam && toParam) {
    return { from: fromParam, to: toParam, period: 'custom' };
  }

  switch (period) {
    case 'ytd':
      return { from: `${y}-01-01`, to: isoDate(now), period: 'ytd' };
    case 'last_week': {
      const day = now.getDay(); // 0=Sun
      const startOfLastWeek = new Date(now);
      startOfLastWeek.setDate(now.getDate() - day - 7);
      const endOfLastWeek = new Date(startOfLastWeek);
      endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
      return { from: isoDate(startOfLastWeek), to: isoDate(endOfLastWeek), period: 'last_week' };
    }
    case 'last_month': {
      const firstOfLastMonth = new Date(y, m - 1, 1);
      const lastOfLastMonth  = new Date(y, m, 0);
      return { from: isoDate(firstOfLastMonth), to: isoDate(lastOfLastMonth), period: 'last_month' };
    }
    default: {
      // this_month
      const firstOfMonth = new Date(y, m, 1);
      return { from: isoDate(firstOfMonth), to: isoDate(now), period: 'this_month' };
    }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Flag gate
  const enabled = await getFlag('invoice_manager_v1');
  if (!enabled) return res.status(403).json({ error: 'invoice_manager_v1 flag is OFF' });

  const { period, from: fromParam, to: toParam } = req.query || {};
  const range = resolveDateRange(period || 'this_month', fromParam, toParam);

  // Load index
  let index = [];
  try {
    const raw = await kvGet('inquiries:index');
    index = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    if (!Array.isArray(index)) index = [];
  } catch { index = []; }

  // Filter to range by event_date
  const inRange = index.filter(inq => {
    const d = inq.event_date || inq.eventDate || '';
    return d >= range.from && d <= range.to;
  });

  // Fetch full records in batches of 20
  const bookedStatuses = new Set(['booked', 'completed']);
  let charged = 0;
  let paid    = 0;

  const BATCH = 20;
  for (let i = 0; i < inRange.length; i += BATCH) {
    const batch = inRange.slice(i, i + BATCH);
    const records = await Promise.all(
      batch.map(inq => kvGet('inquiries:' + inq.threadId).catch(() => null))
    );
    for (const rec of records) {
      if (!rec) continue;
      const parsed = typeof rec === 'string' ? JSON.parse(rec) : rec;
      if (!bookedStatuses.has(parsed.status)) continue;
      const total = parsed.quote && typeof parsed.quote.total === 'number'
        ? parsed.quote.total : 0;
      charged += total;
      if (parsed.paid === true) paid += total;
    }
  }

  const unpaid = Math.max(0, charged - paid);

  return res.status(200).json({
    ok:      true,
    pastDue: 0,
    unpaid,
    charged,
    paid,
    from:    range.from,
    to:      range.to,
    period:  range.period,
    _empty:  charged === 0,
  });
};
