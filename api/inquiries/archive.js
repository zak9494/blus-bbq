/**
 * POST /api/inquiries/archive
 * Two-stage system — Archive an inquiry from Stage 1.
 *
 * Sets status: 'archived', applies BBQ-Archived Gmail label,
 * updates KV record and index.
 *
 * Body: { threadId }
 * Returns: { ok, threadId }
 */
module.exports.config = { maxDuration: 20 };

const https = require('https');

const CANONICAL_SENDER  = 'info@blusbarbeque.com';
const KV_TOKENS_KEY     = 'gmail:' + CANONICAL_SENDER;
const ARCHIVED_LABEL    = 'BBQ-Archived';
const ARCHIVED_KV_KEY   = 'bbq:archived-label-id';

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }
const APP_URL = process.env.APP_URL || 'https://blus-bbq.vercel.app';

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
function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.resolve();
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => { r.resume().on('end', resolve); });
    req.on('error', reject); req.write(body); req.end();
  });
}
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                         catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                         catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.end();
  });
}
function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function getAccessToken() {
  let raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('Gmail not connected');
  let tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let { access_token: atk, expiry_date } = tokens;
  if (!atk || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) throw new Error('No refresh token');
    const rr = await httpsPost('oauth2.googleapis.com', '/token',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }).toString());
    if (rr.status >= 300) throw new Error('Token refresh failed');
    atk = rr.body.access_token;
    tokens = { ...tokens, access_token: atk, expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000 };
    await kvSet(KV_TOKENS_KEY, JSON.stringify(tokens));
  }
  return atk;
}

async function getOrCreateLabel(atk) {
  // Check KV cache
  const cached = await kvGet(ARCHIVED_KV_KEY);
  if (cached && typeof cached === 'string' && cached.trim()) return cached;

  // List labels
  const list = await httpsGet('gmail.googleapis.com',
    '/gmail/v1/users/me/labels', { Authorization: 'Bearer ' + atk });
  const existing = (list.body.labels || []).find(l => l.name === ARCHIVED_LABEL);
  if (existing) { await kvSet(ARCHIVED_KV_KEY, existing.id); return existing.id; }

  // Create label
  const created = await httpsPost('gmail.googleapis.com', '/gmail/v1/users/me/labels',
    { Authorization: 'Bearer ' + atk, 'Content-Type': 'application/json' },
    JSON.stringify({ name: ARCHIVED_LABEL, labelListVisibility: 'labelShow', messageListVisibility: 'show' }));
  if (created.status >= 300) throw new Error('Label create failed: ' + JSON.stringify(created.body));
  await kvSet(ARCHIVED_KV_KEY, created.body.id);
  return created.body.id;
}

function callInternal(path, method, bodyObj) {
  const secret = process.env.GMAIL_READ_SECRET;
  const url = new URL(APP_URL + path + (path.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(secret));
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) } };
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  const { threadId } = body || {};
  if (!threadId) return res.status(400).json({ error: 'threadId required' });

  // Update KV record: status = 'archived'
  const saveResp = await callInternal('/api/inquiries/save', 'POST', {
    threadId, status: 'archived',
    history_entry: { action: 'archived_by_user', actor: 'user' }
  });
  if (saveResp.status >= 300) return res.status(500).json({ error: 'KV save failed', detail: saveResp.body });

  // Apply BBQ-Archived Gmail label (non-fatal if fails)
  let labelWarning = null;
  try {
    const atk = await getAccessToken();
    const labelId = await getOrCreateLabel(atk);
    await httpsPost('gmail.googleapis.com',
      '/gmail/v1/users/me/threads/' + threadId + '/modify',
      { Authorization: 'Bearer ' + atk, 'Content-Type': 'application/json' },
      JSON.stringify({ addLabelIds: [labelId] }));
  } catch(e) {
    labelWarning = 'Gmail label failed (archived in KV only): ' + e.message;
  }

  return res.status(200).json({ ok: true, threadId, ...(labelWarning ? { warning: labelWarning } : {}) });
};
