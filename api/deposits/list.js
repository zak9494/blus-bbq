/* ===== MODULE: DEPOSITS LIST
   GET /api/deposits/list?secret=...&threadId=...
   Returns all recorded deposits for a given inquiry (by threadId).
   KV key: deposits:{threadId} → JSON array of deposit records
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secret   = q.secret;
  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId } = q;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  try {
    const raw = await kvGet('deposits:' + threadId);
    const deposits = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    return res.status(200).json({ ok: true, deposits: Array.isArray(deposits) ? deposits : [] });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
