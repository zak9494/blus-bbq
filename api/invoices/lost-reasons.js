/* GET /api/invoices/lost-reasons?from=YYYY-MM-DD&to=YYYY-MM-DD&secret=...
   Returns breakdown of Lost inquiries by reason for a date range.
   "Date" is the inquiry's lost_at timestamp (when it was marked lost).
   Defaults to last 30 days if from/to are omitted.

   Response: {
     total_count: number,
     total_amount: number,
     by_reason: {
       declined:             { count, amount, pct },
       no_response_customer: { count, amount, pct },
       ...
     }
   }

   Auth: GMAIL_READ_SECRET via ?secret= or X-Secret header.
   Flag: lost_reasons_v1 — 403 if OFF.
*/
'use strict';
const https = require('https');
const { getFlag } = require('../_lib/flags.js');

const REASON_CODES = [
  'declined',
  'no_response_customer',
  'no_response_us',
  'out_of_range',
  'booked_elsewhere',
  'budget_mismatch',
  'other',
  'auto_archive_post_event',
];

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function isAuthorized(req) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  return secret && provided === secret;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const enabled = await getFlag('lost_reasons_v1', false);
  if (!enabled) return res.status(403).json({ error: 'lost_reasons_v1 flag is OFF' });

  // Date range: default last 30 days
  const now = new Date();
  const defaultFrom = new Date(now); defaultFrom.setDate(now.getDate() - 30);
  const from = parseDate(req.query.from) || defaultFrom;
  const to   = parseDate(req.query.to)   || now;
  to.setHours(23,59,59,999);

  const rawIdx = await kvGet('inquiries:index');
  let index = [];
  try { index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { index = []; }

  // Filter to Lost entries
  const lostEntries = index.filter(e => e.status === 'declined');

  // For each lost entry, fetch the full record to get lost_at, lost_reason, quote_total
  const records = await Promise.all(lostEntries.map(async e => {
    const raw = await kvGet('inquiries:' + e.threadId).catch(() => null);
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  }));

  // Filter by lost_at date range
  const inRange = records.filter(r => {
    if (!r) return false;
    // KV index records use snake_case (updated_at). Accept camelCase too so older
    // declined entries without lost_at still count toward the widget.
    const lostTs = r.lost_at || r.updated_at || r.updatedAt;
    if (!lostTs) return false;
    const d = new Date(lostTs);
    return d >= from && d <= to;
  });

  // Aggregate
  let totalCount = 0;
  let totalAmount = 0;
  const byReason = {};

  inRange.forEach(r => {
    const reason = r.lost_reason || 'declined';
    const amount = parseFloat(r.quote_total || r.quoteTotal || 0) || 0;
    totalCount++;
    totalAmount += amount;
    if (!byReason[reason]) byReason[reason] = { count: 0, amount: 0, pct: 0 };
    byReason[reason].count++;
    byReason[reason].amount += amount;
  });

  // Compute percentages
  Object.values(byReason).forEach(v => {
    v.pct = totalCount > 0 ? Math.round((v.count / totalCount) * 100) : 0;
    v.amount = Math.round(v.amount * 100) / 100;
  });

  totalAmount = Math.round(totalAmount * 100) / 100;

  return res.status(200).json({
    total_count: totalCount,
    total_amount: totalAmount,
    from: from.toISOString().slice(0,10),
    to: to.toISOString().slice(0,10),
    by_reason: byReason,
  });
};
