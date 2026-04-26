/**
 * GET /api/inquiries/thread?threadId=X&secret=Y
 * Wave 4 — Returns structured Gmail thread messages for the iMessage-style thread view.
 * Falls back gracefully to raw_email if Gmail tokens are unavailable.
 *
 * Returns: { ok, messages: [{ id, direction, from, fromName, to, date, subject, body, attachments }] }
 * direction: 'inbound' (customer → Blu's) | 'outbound' (Blu's → customer)
 */

module.exports.config = { maxDuration: 15 };

const https = require('https');

const CANONICAL_SENDER = 'info@blusbarbeque.com';
const KV_TOKENS_KEY = 'gmail:' + CANONICAL_SENDER;

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

function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function getAccessToken() {
  const raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('No Gmail token');
  const tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let { access_token, refresh_token, expiry_date } = tokens;
  if (access_token && (!expiry_date || expiry_date > Date.now() + 60000)) return access_token;
  if (!refresh_token) throw new Error('No refresh token');
  const body = Buffer.from(new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token, grant_type: 'refresh_token',
  }).toString());
  const rr = await new Promise((res, rej) => {
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
  if (!rr.access_token) throw new Error('Token refresh failed');
  await kvSet(KV_TOKENS_KEY, JSON.stringify({
    ...tokens, access_token: rr.access_token,
    expiry_date: Date.now() + (rr.expires_in || 3600) * 1000,
  }));
  return rr.access_token;
}

function gmailGet(token, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'gmail.googleapis.com', path, method: 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                          catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.end();
  });
}

function getBodyText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = getBodyText(part);
      if (text) return text;
    }
  }
  return '';
}

function getAttachments(payload) {
  if (!payload) return [];
  const results = [];
  const parts = payload.parts || [];
  for (const part of parts) {
    if (part.filename && part.filename.length > 0 && part.body) {
      results.push({
        name: part.filename,
        size: part.body.size || 0,
        mimeType: part.mimeType || '',
        attachmentId: part.body.attachmentId || '',
      });
    } else if (part.parts) {
      results.push(...getAttachments(part));
    }
  }
  return results;
}

function parseDisplayName(fromHeader) {
  if (!fromHeader) return '';
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return fromHeader.replace(/<[^>]+>/, '').trim();
}

function parseMessage(m) {
  const headers = (m.payload && m.payload.headers) || [];
  const get = name => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
  const from = get('From');
  const direction = from.toLowerCase().includes(CANONICAL_SENDER) ? 'outbound' : 'inbound';
  const rawDate = get('Date');
  let date;
  try { date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(); }
  catch { date = new Date().toISOString(); }

  return {
    id: m.id,
    direction,
    from,
    fromName: parseDisplayName(from),
    to: get('To'),
    subject: get('Subject'),
    date,
    body: getBodyText(m.payload),
    attachments: getAttachments(m.payload),
  };
}

function fallbackMessages(rec) {
  if (!rec.raw_email) return [];
  const ef = rec.extracted_fields || {};
  const fromRaw = rec.from || rec.raw_email.from || '';
  return [{
    id: rec.messageId || 'raw-0',
    direction: 'inbound',
    from: fromRaw,
    fromName: ef.customer_name || parseDisplayName(fromRaw) || fromRaw,
    to: CANONICAL_SENDER,
    subject: rec.subject || rec.raw_email.subject || '',
    date: rec.date || rec.raw_email.date || rec.created_at || new Date().toISOString(),
    body: rec.raw_email.body || '',
    attachments: [],
  }];
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!secretGate(req, res)) return;

  const threadId = req.query && req.query.threadId;
  if (!threadId) return res.status(400).json({ error: 'threadId required' });

  let rec;
  try {
    const raw = await kvGet('inquiries:' + threadId);
    if (!raw) return res.status(404).json({ error: 'Inquiry not found' });
    rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'KV read failed', detail: e.message });
  }

  // Attempt Gmail thread fetch
  let accessToken;
  try { accessToken = await getAccessToken(); }
  catch { return res.status(200).json({ ok: true, messages: fallbackMessages(rec) }); }

  let threadResp;
  try {
    threadResp = await gmailGet(accessToken,
      '/gmail/v1/users/me/threads/' + encodeURIComponent(threadId) + '?format=full');
  } catch {
    return res.status(200).json({ ok: true, messages: fallbackMessages(rec) });
  }

  if (threadResp.status !== 200 || !threadResp.body || !threadResp.body.messages) {
    return res.status(200).json({ ok: true, messages: fallbackMessages(rec) });
  }

  const messages = threadResp.body.messages.map(parseMessage);
  return res.status(200).json({ ok: true, messages });
};
