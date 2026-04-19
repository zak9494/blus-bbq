/**
 * GET /api/diag/verify-sender?limit=3&secret=<SELF_MODIFY_SECRET>
 *
 * Read-only diagnostic. Uses the KV-stored Gmail token for
 * info@blusbarbeque.com to hit Gmail API users.messages.list on
 * the SENT label and returns the literal From: header for each
 * of the most recent messages. This is the ground-truth check
 * that the sender lockdown is honored at delivery time (Gmail
 * API returning "sent" isn't by itself proof the From header is
 * correct — this endpoint closes that loop).
 *
 * Never sends anything. Never mutates KV except to refresh the
 * access_token when it's expired (same behavior as the dispatch
 * endpoint). Secret-gated to avoid leaking subject/to metadata.
 */
const https = require('https');

const CANONICAL_SENDER = 'info@blusbarbeque.com';
const KV_TOKENS_KEY = `gmail:${CANONICAL_SENDER}`;

// Same fallback chain as self-modify.js so this works even when
// SELF_MODIFY_SECRET hasn't been added to Vercel env vars yet.
const EFFECTIVE_SECRET = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN || null;

function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.resolve();
  return new Promise(resolve => {
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

function httpsJson(hostname, path, headers, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const opts = {
      hostname, path, method,
      headers: { ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function refreshToken(refreshTok) {
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: refreshTok,
    grant_type: 'refresh_token',
  }).toString();
  return httpsJson(
    'oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    'POST', body
  );
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const expected = EFFECTIVE_SECRET;
  if (!expected) return res.status(500).json({ error: 'No secret configured (set SELF_MODIFY_SECRET or GITHUB_TOKEN env var)' });
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (provided !== expected) return res.status(401).json({ error: 'Invalid or missing secret' });

  const limit = Math.max(1, Math.min(10, parseInt((req.query && req.query.limit), 10) || 3));

  const tokensRaw = await kvGet(KV_TOKENS_KEY);
  if (!tokensRaw) {
    return res.status(400).json({
      error: `No Gmail tokens stored at ${KV_TOKENS_KEY}. Re-authenticate at /api/auth/init.`
    });
  }

  let tokens;
  try { tokens = typeof tokensRaw === 'string' ? JSON.parse(tokensRaw) : tokensRaw; }
  catch { return res.status(500).json({ error: 'Could not parse stored tokens' }); }

  // Sender-lockdown guard (same invariant as dispatch/email.js)
  if (tokens.email && tokens.email !== CANONICAL_SENDER) {
    return res.status(400).json({
      error: `Token account mismatch: stored=${tokens.email}, required=${CANONICAL_SENDER}`
    });
  }

  let atk = tokens.access_token;
  if (!atk || (tokens.expiry_date && tokens.expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) {
      return res.status(400).json({ error: 'No refresh_token; re-auth at /api/auth/init.' });
    }
    const rr = await refreshToken(tokens.refresh_token);
    if (rr.status >= 300 || (rr.body && rr.body.error)) {
      return res.status(500).json({ error: 'Token refresh failed', detail: rr.body });
    }
    atk = rr.body.access_token;
    tokens = {
      ...tokens,
      access_token: atk,
      expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000
    };
    await kvSet(KV_TOKENS_KEY, JSON.stringify(tokens));
  }

  // List most recent SENT messages
  const listResp = await httpsJson(
    'gmail.googleapis.com',
    `/gmail/v1/users/me/messages?labelIds=SENT&maxResults=${limit}`,
    { Authorization: 'Bearer ' + atk }
  );
  if (listResp.status >= 300) {
    return res.status(502).json({ error: 'Gmail list failed', status: listResp.status, detail: listResp.body });
  }

  const messages = (listResp.body && listResp.body.messages) || [];
  const results = [];
  for (const m of messages) {
    const g = await httpsJson(
      'gmail.googleapis.com',
      `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Return-Path&metadataHeaders=Sender`,
      { Authorization: 'Bearer ' + atk }
    );
    if (g.status >= 300) {
      results.push({ id: m.id, error: g.body });
      continue;
    }
    const headers = (g.body.payload && g.body.payload.headers) || [];
    const h = headers.reduce((acc, cur) => { acc[cur.name.toLowerCase()] = cur.value; return acc; }, {});
    const fromStr = h.from || null;
    const fromEmail = fromStr
      ? ((fromStr.match(/<([^>]+)>/) || [])[1] || fromStr).toLowerCase().trim()
      : null;
    results.push({
      id: m.id,
      threadId: m.threadId,
      internalDate: g.body.internalDate,
      dateHeader: h.date || null,
      from: fromStr,                  // literal From: header as delivered
      fromEmail,                       // parsed out email address
      fromIsCanonical: fromEmail === CANONICAL_SENDER,
      returnPath: h['return-path'] || null,
      senderHeader: h.sender || null,
      to: h.to || null,
      subject: h.subject || null,
      labelIds: g.body.labelIds || [],
      snippet: (g.body.snippet || '').slice(0, 80),
    });
  }

  const allCanonical = results.length > 0 && results.every(r => r.fromIsCanonical);

  return res.status(200).json({
    ok: true,
    canonicalSender: CANONICAL_SENDER,
    allCanonical,
    count: results.length,
    messages: results,
  });
};
