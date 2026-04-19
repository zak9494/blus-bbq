/**
 * POST /api/inquiries/acknowledge
 * R4-2 — Marks all activity log entries as acknowledged and clears has_unreviewed_update.
 */
module.exports.config = { maxDuration: 10 };
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + token } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function callInternal(path, method, bodyObj) {
  const secret = process.env.GMAIL_READ_SECRET;
  const appUrl = process.env.APP_URL || 'https://blus-bbq.vercel.app';
  const sep = path.includes('?') ? '&' : '?';
  const url = new URL(appUrl + path + sep + 'secret=' + encodeURIComponent(secret));
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: method || 'GET',
      headers: { 'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = req.headers['x-secret'] || (req.query && req.query.secret);
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId } = req.body || {};
  if (!threadId) return res.status(400).json({ error: 'threadId required' });

  // Load existing record
  const recRaw = await kvGet('inquiries:' + threadId);
  if (!recRaw) return res.status(404).json({ error: 'Not found' });
  const rec = typeof recRaw === 'string' ? JSON.parse(recRaw) : recRaw;

  // Mark all activity log entries acknowledged
  const actLog = (rec.activity_log || []).map(e => ({ ...e, acknowledged: true }));

  // Save via save.js
  const r = await callInternal('/api/inquiries/save', 'POST', {
    threadId,
    has_unreviewed_update: false,
    activity_log: actLog,
    history_entry: { action: 'acknowledged', actor: 'user' },
  });

  return res.status(200).json({ ok: r.body && r.body.ok, threadId });
};
