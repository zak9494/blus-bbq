/**
 * GET /api/gmail/list-inquiries
 * R4-1 Phase 1 — Lists catering inquiry emails from the info@blusbarbeque.com inbox.
 *
 * Auth: requires ?secret=<GMAIL_READ_SECRET> query param OR X-Secret header.
 * Returns: { count, inquiries: [{threadId, messageId, subject, from, to, date, snippet, body, labels}] }
 *
 * Requires gmail.readonly scope on stored OAuth tokens.
 * If 401/403 from Gmail: re-consent at /api/auth/init (added scope in R4-1 Phase 1).
 * GMAIL_READ_SECRET env var must be set in Vercel project settings.
 */

module.exports.config = { maxDuration: 60 };

const https = require('https');

const CANONICAL_SENDER = 'info@blusbarbeque.com';
const KV_TOKENS_KEY = `gmail:${CANONICAL_SENDER}`;

function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) throw new Error('KV env vars not set');
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify([
      ['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]
    ]);
    const u = new URL(url + '/pipeline');
    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method: 'GET', headers };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();
  return httpsPost('oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
}

/** Decode base64url → UTF-8 string */
function decodeBase64url(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/** Recursively extract readable text body from a Gmail message payload */
function extractBody(payload) {
  if (!payload) return '';
  // Single-part: body.data is the content
  if (payload.body && payload.body.data) return decodeBase64url(payload.body.data);
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data)
        return decodeBase64url(part.body.data);
    }
    // Fall back to text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body && part.body.data)
        return decodeBase64url(part.body.data);
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Secret gate ─────────────────────────────────────────────────────────────
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) return res.status(500).json({ error: 'GMAIL_READ_SECRET env var not configured' });
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized — invalid or missing secret' });

  // ── Load tokens from KV ─────────────────────────────────────────────────────
  let tokensRaw;
  try { tokensRaw = await kvGet(KV_TOKENS_KEY); } catch (e) {
    return res.status(500).json({ error: 'KV read failed', detail: e.message });
  }
  if (!tokensRaw) {
    return res.status(403).json({
      error: 'Gmail not connected',
      action: 'Visit /api/auth/init to authenticate with gmail.readonly scope'
    });
  }
  let tokens = typeof tokensRaw === 'string' ? JSON.parse(tokensRaw) : tokensRaw;

  // ── Refresh access token if expired ────────────────────────────────────────
  let { access_token: atk, expiry_date } = tokens;
  if (!atk || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) {
      return res.status(403).json({ error: 'No refresh token stored. Re-auth at /api/auth/init.' });
    }
    const rr = await refreshAccessToken(tokens.refresh_token);
    if (rr.status >= 300 || (rr.body && rr.body.error)) {
      return res.status(403).json({ error: 'Token refresh failed — re-auth required', detail: rr.body });
    }
    atk = rr.body.access_token;
    tokens = { ...tokens, access_token: atk, expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000 };
    await kvSet(KV_TOKENS_KEY, JSON.stringify(tokens));
  }

  const authHeader = 'Bearer ' + atk;

  // ── List matching threads ───────────────────────────────────────────────────
  // Strict Wix-form-only filter: only 'Catering Request got a new submission' notifications
  const q = encodeURIComponent('subject:"Catering Request got a new submission"');
  const listResp = await httpsGet('gmail.googleapis.com',
    `/gmail/v1/users/me/messages?q=${q}&maxResults=100`,
    { Authorization: authHeader });

  if (listResp.status === 401 || listResp.status === 403) {
    return res.status(listResp.status).json({
      error: 'Gmail API returned ' + listResp.status + ' — gmail.readonly scope likely missing',
      detail: listResp.body,
      action: 'Re-consent at /api/auth/init (gmail.readonly scope added in R4-1 Phase 1)'
    });
  }
  if (listResp.status >= 300) {
    return res.status(502).json({ error: 'Gmail list failed', status: listResp.status, detail: listResp.body });
  }

  const messageRefs = listResp.body.messages || [];

  // ── Deduplicate by threadId (one entry per thread, first message wins) ──────
  const seenThreads = new Set();
  const uniqueRefs  = messageRefs.filter(({ threadId }) => {
    if (seenThreads.has(threadId)) return false;
    seenThreads.add(threadId); return true;
  });

  // ── Fetch full message for each ref ────────────────────────────────────────
  const inquiries = [];
  for (const { id: messageId, threadId } of uniqueRefs) {
    const msgResp = await httpsGet('gmail.googleapis.com',
      `/gmail/v1/users/me/messages/${messageId}?format=full`,
      { Authorization: authHeader });
    if (msgResp.status >= 300) continue; // skip individual failures silently

    const msg = msgResp.body;
    const hdrs = (msg.payload && msg.payload.headers) || [];
    inquiries.push({
      threadId: msg.threadId || threadId,
      messageId: msg.id,
      subject: getHeader(hdrs, 'Subject'),
      from: getHeader(hdrs, 'From'),
      to: getHeader(hdrs, 'To'),
      date: getHeader(hdrs, 'Date'),
      snippet: msg.snippet || '',
      body: extractBody(msg.payload),
      labels: msg.labelIds || [],
    });
  }

  return res.status(200).json({
    count: inquiries.length,
    inquiries,
    query: 'subject:"Catering Request got a new submission"',
    fetchedAt: new Date().toISOString(),
  });
};
