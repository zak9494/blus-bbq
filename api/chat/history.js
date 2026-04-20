/* ===== MODULE: CHAT HISTORY (C21)
   GET  /api/chat/history?secret=...      → { ok, messages: [...] }
   POST /api/chat/history                 → body { secret, messages: [...] }
   Persists AI chat history in KV for session continuity across reloads.
   KV key: chat:history  (single-user system; max 100 messages stored)
   ===== */
'use strict';
const https = require('https');

const HISTORY_KEY  = 'chat:history';
const MAX_MESSAGES = 100;

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

  // ── GET: load history ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const secret = (req.query || {}).secret;
    if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const raw      = await kvGet(HISTORY_KEY);
      const messages = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return res.status(200).json({ ok: true, messages });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }

  // ── POST: save history ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body   = req.body || {};
    const secret = body.secret;
    if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    let messages = body.messages;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });
    // Trim to MAX_MESSAGES (keep most recent)
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    // Sanitise: only allow role/content pairs
    messages = messages.map(function(m) { return { role: m.role, content: m.content }; });
    try {
      await kvSet(HISTORY_KEY, JSON.stringify(messages));
      return res.status(200).json({ ok: true, count: messages.length });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
