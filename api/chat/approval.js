/* ===== MODULE: CHAT APPROVAL QUEUE (D24)
   GET  /api/chat/approval?secret=...        → { ok, items: [...] }
   POST /api/chat/approval                   → body { secret, item: { id, to, subject, body, createdAt } }
   DELETE /api/chat/approval?secret=...&id=  → { ok }
   KV key: chat:approval:queue → JSON array of pending draft items
   ===== */
'use strict';
const https  = require('https');
const crypto = require('crypto');

const QUEUE_KEY = 'chat:approval:queue';
const MAX_ITEMS = 20;

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

  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const q        = req.query || {};

  // ── GET: list queue ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!expected || q.secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const raw   = await kvGet(QUEUE_KEY);
      const items = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return res.status(200).json({ ok: true, items });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST: enqueue item ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    if (!expected || body.secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    const item = body.item;
    if (!item || !item.to || !item.subject) return res.status(400).json({ error: 'item.to and item.subject required' });
    item.id = item.id || ('ap-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
    item.createdAt = item.createdAt || new Date().toISOString();
    try {
      const raw   = await kvGet(QUEUE_KEY);
      const items = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      items.unshift(item);
      if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
      await kvSet(QUEUE_KEY, JSON.stringify(items));
      return res.status(200).json({ ok: true, id: item.id });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── DELETE: remove item ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!expected || q.secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    const id = q.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const raw   = await kvGet(QUEUE_KEY);
      const items = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      const next  = items.filter(function(i) { return i.id !== id; });
      await kvSet(QUEUE_KEY, JSON.stringify(next));
      return res.status(200).json({ ok: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
