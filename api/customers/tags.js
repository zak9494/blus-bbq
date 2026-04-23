/* GET  /api/customers/tags?email=...&secret=...
   POST /api/customers/tags
        body: { email, add?: string[], remove?: string[], secret }
   Returns { ok, email, tags: string[] }
   KV key: customer:tags:{email_lowercase}
*/
'use strict';
const https = require('https');
const { getFlag } = require('../_lib/flags.js');

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

function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['SET', key, JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function getTags(email) {
  const key = 'customer:tags:' + email.toLowerCase().trim();
  try {
    const raw = await kvGet(key);
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) ||
                   (req.body && req.body.secret) ||
                   req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const enabled = await getFlag('customer_tags', true);
  if (!enabled) return res.status(403).json({ error: 'Feature disabled' });

  if (req.method === 'GET') {
    const email = (req.query && req.query.email) || '';
    if (!email) return res.status(400).json({ error: 'email required' });
    const tags = await getTags(email);
    return res.status(200).json({ ok: true, email, tags });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const email = (body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const add    = Array.isArray(body.add)    ? body.add    : [];
    const remove = Array.isArray(body.remove) ? body.remove : [];

    let tags = await getTags(email);

    // Add new tags (dedup, case-preserve)
    for (const t of add) {
      const tag = String(t).trim();
      if (tag && !tags.some(x => x.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag);
      }
    }
    // Remove tags (case-insensitive match)
    if (remove.length) {
      const rmSet = new Set(remove.map(x => String(x).toLowerCase()));
      tags = tags.filter(t => !rmSet.has(t.toLowerCase()));
    }

    const key = 'customer:tags:' + email;
    await kvSet(key, tags);
    return res.status(200).json({ ok: true, email, tags });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
