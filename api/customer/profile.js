/**
 * GET  /api/customer/profile?email=...  — aggregated customer stats + inquiry history + notes
 * POST /api/customer/profile             — save customer notes { email, notes }
 *
 * Response (GET): { ok, email, name, stats: { totalEvents, bookedCount, totalSpend,
 *   avgOrderSize, lastEventDate }, inquiries: [...indexEntries], notes }
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

function kvSet(key, value) {
  const url = kvUrl(), tok = kvToken();
  if (!url) return Promise.resolve();
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

function extractEmail(inq) {
  if (inq.customer_email) return normalizeEmail(inq.customer_email);
  const from = inq.from || '';
  const m = from.match(/<(.+?)>/);
  return m ? normalizeEmail(m[1]) : normalizeEmail(from);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!secretGate(req, res)) return;

  // POST — save notes
  if (req.method === 'POST') {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const email = normalizeEmail(body.email);
    if (!email) return res.status(400).json({ error: 'email required' });
    const notes = typeof body.notes === 'string' ? body.notes : '';
    await kvSet('customer:notes:' + email, { notes, updated_at: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = normalizeEmail(req.query && req.query.email);
  if (!email) return res.status(400).json({ error: 'email required' });

  // Load index
  let index = [];
  try {
    const raw = await kvGet('inquiries:index');
    index = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
  } catch (_) {}

  // Filter by email
  const matches = index.filter(inq => {
    if (inq.status === 'archived') return false;
    return extractEmail(inq) === email;
  }).sort((a, b) => new Date(b.event_date || b.updated_at || 0) - new Date(a.event_date || a.updated_at || 0));

  // Compute stats
  let bookedCount = 0;
  let totalSpend = 0;
  let lastEventDate = null;
  let name = '';

  for (const inq of matches) {
    if (!name && (inq.customer_name || inq.from)) {
      name = inq.customer_name || inq.from;
    }
    const isBooked = inq.status === 'booked' || inq.status === 'completed';
    if (isBooked) {
      bookedCount++;
      const qt = parseFloat(inq.quote_total);
      if (!isNaN(qt)) totalSpend += qt;
    }
    if (inq.event_date && (!lastEventDate || inq.event_date > lastEventDate)) {
      lastEventDate = inq.event_date;
    }
  }

  const totalEvents = matches.length;
  const avgOrderSize = bookedCount > 0 ? Math.round(totalSpend / bookedCount) : 0;

  // Load notes
  let notes = '';
  try {
    const raw = await kvGet('customer:notes:' + email);
    if (raw) {
      const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
      notes = rec.notes || '';
    }
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    email,
    name,
    stats: { totalEvents, bookedCount, totalSpend, avgOrderSize, lastEventDate },
    inquiries: matches,
    notes,
  });
};
