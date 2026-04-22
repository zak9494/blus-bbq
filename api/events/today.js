/* GET /api/events/today
   Auth: ?secret=GMAIL_READ_SECRET or X-Secret header
   Returns { ok, date, events } — today's booked/in-progress events sorted by event_time.
*/
'use strict';
module.exports.config = { maxDuration: 20 };

const https = require('https');

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

function chicagoDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

const EVENT_STATUSES = new Set(['booked', 'in_progress', 'completed']);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const today = chicagoDateStr();

  let index;
  try {
    const raw = await kvGet('inquiries:index');
    index = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    if (!Array.isArray(index)) index = [];
  } catch (e) {
    return res.status(500).json({ error: 'KV read failed', detail: e.message });
  }

  const todayEntries = index.filter(e =>
    e.event_date === today && EVENT_STATUSES.has(e.status)
  );

  const events = await Promise.all(todayEntries.map(async entry => {
    try {
      const raw = await kvGet('inquiries:' + entry.threadId);
      const full = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      if (!full) return null;
      const ef = full.extracted_fields || {};
      return {
        threadId:         entry.threadId,
        customer_name:    ef.customer_name   || entry.customer_name  || entry.from || '(Unknown)',
        customer_phone:   ef.customer_phone  || entry.customer_phone || null,
        customer_email:   ef.customer_email  || entry.email          || null,
        event_date:       ef.event_date      || entry.event_date     || today,
        event_time:       ef.event_time      || full.event_time      || null,
        guest_count:      ef.guest_count     || entry.guest_count    || null,
        service_type:     ef.service_type    || 'pickup',
        delivery_address: ef.delivery_address || full.delivery_address || null,
        special_requests: ef.special_requests || full.special_requests || null,
        status:           full.status        || entry.status,
        quote:            full.quote         || null,
      };
    } catch { return null; }
  }));

  const sorted = events
    .filter(Boolean)
    .sort((a, b) => {
      const ta = a.event_time || '99:99';
      const tb = b.event_time || '99:99';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

  return res.status(200).json({ ok: true, date: today, events: sorted });
};
