/**
 * GET /api/inquiries/completed
 * Period-filtered completed orders + aggregated totals.
 * period = this_week|last_week|this_month|last_month|ytd|last_year|custom|all
 * Auth: GMAIL_READ_SECRET via ?secret= or X-Secret header
 */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), tok = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function secretGate(req) {
  const s = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  return s && provided === s;
}

function periodRange(period, now, customStart, customEnd) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const pad = n => String(n).padStart(2, '0');
  const ymd = (yr, mo, da) => `${yr}-${pad(mo + 1)}-${pad(da)}`;
  const dow = now.getDay(), mondayOffset = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(now); thisMonday.setDate(d + mondayOffset);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);
  switch (period) {
    case 'this_week':  return [ymd(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate()), ymd(y, m, d)];
    case 'last_week':  return [ymd(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate()), ymd(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate())];
    case 'this_month': return [ymd(y, m, 1), ymd(y, m, d)];
    case 'last_month': { const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y, lastDay = new Date(y, m, 0).getDate(); return [ymd(ly, lm, 1), ymd(ly, lm, lastDay)]; }
    case 'ytd':        return [ymd(y, 0, 1), ymd(y, m, d)];
    case 'last_year':  return [ymd(y - 1, 0, 1), ymd(y - 1, 11, 31)];
    case 'custom':     return [customStart || ymd(y, m, 1), customEnd || ymd(y, m, d)];
    default:           return [null, null];
  }
}

function inDateRange(dateStr, start, end) {
  if (!start && !end) return true;
  if (!dateStr) return false;
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

const BATCH = 10;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!secretGate(req)) return res.status(401).json({ error: 'Unauthorized' });

  const period      = (req.query && req.query.period) || 'this_month';
  const customStart = req.query && req.query.start;
  const customEnd   = req.query && req.query.end;

  try {
    const rawIdx = await kvGet('inquiries:index');
    const index  = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];

    const completedEntries = index.filter(e => e.status === 'completed');
    const [rangeStart, rangeEnd] = period === 'all' ? [null, null] : periodRange(period, new Date(), customStart, customEnd);
    const inPeriod = completedEntries.filter(e => inDateRange(e.event_date, rangeStart, rangeEnd));

    const orders = [];
    for (let i = 0; i < inPeriod.length; i += BATCH) {
      const batch   = inPeriod.slice(i, i + BATCH);
      const records = await Promise.all(batch.map(async entry => {
        try {
          const raw = await kvGet('inquiries:' + entry.threadId);
          if (!raw) return null;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { return null; }
      }));
      for (let j = 0; j < batch.length; j++) {
        const entry  = batch[j];
        const record = records[j];
        const q      = record && record.quote;
        orders.push({
          threadId:       entry.threadId,
          customer_name:  (record && record.extracted_fields && record.extracted_fields.customer_name)  || entry.customer_name  || '',
          customer_email: (record && record.extracted_fields && record.extracted_fields.customer_email) || '',
          event_date:     entry.event_date    || '',
          guest_count:    (record && record.extracted_fields && record.extracted_fields.guest_count) || entry.guest_count || null,
          completed_at:   entry.completed_at  || (record && record.completed_at) || '',
          total_billed:   (q && q.grand_total)     || 0,
          subtotal:       (q && q.food_subtotal)   || 0,
          delivery_fee:   (q && q.delivery_fee)    || 0,
          service_charge: (q && q.service_charge)  || 0,
          tax:            (q && q.tax_amount)      || 0,
        });
      }
    }

    orders.sort((a, b) => b.event_date > a.event_date ? 1 : b.event_date < a.event_date ? -1 : 0);

    const totals = orders.reduce((acc, o) => {
      acc.total_billed     += o.total_billed;
      acc.subtotal         += o.subtotal;
      acc.delivery_fees    += o.delivery_fee;
      acc.service_charges  += o.service_charge;
      return acc;
    }, { count: orders.length, total_billed: 0, subtotal: 0, delivery_fees: 0, service_charges: 0 });

    return res.status(200).json({ ok: true, period, range_start: rangeStart || null, range_end: rangeEnd || null, count: orders.length, totals, orders });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
