/* ===== MODULE: PUSH SUBSCRIPTION STORE
   POST   /api/notifications/subscribe  { secret, subscription: PushSubscription }
   DELETE /api/notifications/subscribe?secret=...&endpoint=<encoded>
   GET    /api/notifications/subscribe?secret=...  → { ok, count, subscriptions }
   KV key: push:subscriptions → JSON array (max 50)
   ===== */
'use strict';
const https = require('https');

const KV_KEY  = 'push:subscriptions';
const MAX_SUBS = 50;

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

async function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const q = req.query || {};

  /* ── POST: save subscription ────────────────────────────────── */
  if (req.method === 'POST') {
    const body = req.body || {};
    if (!secret || body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const sub = body.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription.endpoint required' });
    try {
      const raw  = await kvGet(KV_KEY);
      const subs = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      // Deduplicate by endpoint; newest first
      const rest = subs.filter(s => s.endpoint !== sub.endpoint);
      rest.unshift({ ...sub, savedAt: new Date().toISOString() });
      if (rest.length > MAX_SUBS) rest.length = MAX_SUBS;
      await kvSet(KV_KEY, JSON.stringify(rest));
      return res.status(200).json({ ok: true });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  /* ── GET: list subscriptions (admin) ───────────────────────── */
  if (req.method === 'GET') {
    if (!secret || q.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const raw  = await kvGet(KV_KEY);
      const subs = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return res.status(200).json({ ok: true, count: subs.length });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  /* ── DELETE: remove subscription ───────────────────────────── */
  if (req.method === 'DELETE') {
    if (!secret || q.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const endpoint = q.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    try {
      const raw  = await kvGet(KV_KEY);
      const subs = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      const next = subs.filter(s => s.endpoint !== endpoint);
      await kvSet(KV_KEY, JSON.stringify(next));
      return res.status(200).json({ ok: true });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
