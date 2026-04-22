/* ===== MODULE: CUSTOMER NOTES
   GET  /api/customer/notes?email=...&secret=...  → { notes }
   POST /api/customer/notes → body { email, notes, secret } → { ok }
   KV key: customer:<email>:notes
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const expected = process.env.GMAIL_READ_SECRET;

  if (req.method === 'GET') {
    const q      = req.query || {};
    const secret = q.secret;
    if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    const email = (q.email || '').toLowerCase().trim();
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'valid email required' });
    const raw = await kvGet('customer:' + email + ':notes');
    return res.status(200).json({ ok: true, notes: raw || '' });
  }

  if (req.method === 'POST') {
    const body   = req.body || {};
    const secret = body.secret;
    if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    const email = (body.email || '').toLowerCase().trim();
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'valid email required' });
    const notes = (body.notes || '').slice(0, 5000); // 5KB cap
    try {
      await kvSet('customer:' + email + ':notes', notes);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
