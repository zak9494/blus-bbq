/**
 * POST /api/dispatch/email
 * Called by QStash at scheduled time.
 * Verifies signature → loads Gmail tokens from KV → refreshes if needed → sends email.
 */
const https = require('https');
const crypto = require('crypto');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) throw new Error('KV env vars not set');
  return new Promise((resolve, reject) => {
    const u = new URL(`${url}/get/${encodeURIComponent(key)}`);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: `Bearer ${token}` } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { const p = JSON.parse(d); resolve(p.result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

async function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(['SET', key, value]);
    const u = new URL(`${url}/pipeline`);
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function verifyQStashSig(rawBody, signature, key) {
  try {
    const parts = signature.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
    if (expected !== sig) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return false;
    if (claims.nbf && claims.nbf > now + 5) return false;
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('base64url');
    if (claims.body && claims.body !== bodyHash) return false;
    return true;
  } catch { return false; }
}

async function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(data); req.end();
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

async function sendEmail(accessToken, to, subject, htmlBody) {
  const mime = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/html; charset=utf-8', 'MIME-Version: 1.0', '', htmlBody].join('\r\n');
  const encoded = Buffer.from(mime).toString('base64url');
  return httpsPost('gmail.googleapis.com', '/gmail/v1/users/me/messages/send',
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    JSON.stringify({ raw: encoded }));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await new Promise(resolve => {
    let data = ''; req.on('data', c => data += c); req.on('end', () => resolve(data));
  });

  const sig = req.headers['upstash-signature'];
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (currentKey) {
    const valid = (sig && (verifyQStashSig(rawBody, sig, currentKey) ||
                           (nextKey && verifyQStashSig(rawBody, sig, nextKey))));
    if (!valid) return res.status(401).json({ error: 'Invalid QStash signature' });
  }

  let body; try { body = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  const { taskId, payload: directPayload } = body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });

  const taskRaw = await kvGet(`task:${taskId}`);
  if (!taskRaw) return res.status(404).json({ error: `task ${taskId} not found` });
  const task = typeof taskRaw === 'string' ? JSON.parse(taskRaw) : taskRaw;

  const fail = async (reason) => {
    await kvSet(`task:${taskId}`, JSON.stringify({ ...task, status: 'failed', failReason: reason, updatedAt: new Date().toISOString() }));
    return res.status(422).json({ error: reason });
  };

  const tokensRaw = await kvGet('gmail:tokens');
  if (!tokensRaw) return fail('Gmail not connected — no tokens in KV. Re-auth from dashboard.');
  let tokens = typeof tokensRaw === 'string' ? JSON.parse(tokensRaw) : tokensRaw;

  let { access_token: accessToken, expiry_date } = tokens;
  if (!accessToken || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) return fail('No Gmail refresh token — re-auth with offline access.');
    const rr = await refreshAccessToken(tokens.refresh_token);
    if (rr.status >= 300 || rr.body.error) return fail(`Token refresh failed: ${JSON.stringify(rr.body)}`);
    accessToken = rr.body.access_token;
    tokens = { ...tokens, access_token: accessToken, expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000 };
    await kvSet('gmail:tokens', JSON.stringify(tokens));
  }

  const ep = task.payload || directPayload || {};
  if (!ep.to) return fail('payload.to is required');

  const result = await sendEmail(accessToken, ep.to, ep.subject || '(no subject)', ep.body || '');
  if (result.status >= 300) {
    return fail(`Gmail API ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`);
  }

  await kvSet(`task:${taskId}`, JSON.stringify({
    ...task, status: 'sent', gmailMessageId: result.body.id,
    sentAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }));
  return res.status(200).json({ ok: true, taskId, gmailMessageId: result.body.id });
};
