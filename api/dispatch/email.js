// Tell Vercel NOT to auto-parse the body - we need raw stream for QStash sig verification
module.exports.config = { api: { bodyParser: false } };

const https = require('https');
const crypto = require('crypto');
const { getTestModeEmail } = require('../_lib/settings.js');
const { getAllowedAccounts, isAllowedAccount } = require('../_lib/allowed-accounts');

const CANONICAL_SENDER = getAllowedAccounts()[0];
const KV_TOKENS_KEY = `gmail:${CANONICAL_SENDER}`;
const KV_TOKENS_KEY_LEGACY = 'gmail:tokens';

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

function verifyQStashSig(rawBody, signature, key) {
  try {
    const parts = signature.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', key).update(header + '.' + payload).digest('base64url');
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
    const opts = {
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(data);
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
  return httpsPost('oauth2.googleapis.com', '/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
}

// Test-mode safety rail — redirects recipient to the configured test email address.
// Throws if inquiry is a test but no target is configured (fail-loud; prevents accidental send).
// NEVER modifies the sender (CANONICAL_SENDER lockdown is untouched).
// Exported for unit testing.
async function resolveRecipient(to, context) {
  var inq = (context && context.inquiry) || {};
  var isTest = inq.test === true || context.testOverride === true ||
      (typeof inq.threadId === 'string' && inq.threadId.startsWith('test-'));
  if (!isTest) return to;
  const testEmail = await getTestModeEmail();
  if (!testEmail) {
    throw new Error('Test mode email target not configured. Go to Settings \u2192 Feature Flags and set the target.');
  }
  return testEmail;
}

async function sendEmail(tok, to, subject, htmlBody) {
  const mime = [
    'From: ' + CANONICAL_SENDER,
    'To: ' + to,
    'Subject: ' + subject,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    htmlBody
  ].join('\r\n');
  const encoded = Buffer.from(mime).toString('base64url');
  return httpsPost(
    'gmail.googleapis.com',
    '/gmail/v1/users/me/messages/send',
    { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    JSON.stringify({ raw: encoded })
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });

  const sig = req.headers['upstash-signature'];
  const curKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nxtKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (curKey) {
    const valid = sig && (verifyQStashSig(rawBody, sig, curKey) || (nxtKey && verifyQStashSig(rawBody, sig, nxtKey)));
    if (!valid) return res.status(401).json({ error: 'Invalid QStash signature' });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { taskId, payload: directPayload } = body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });

  const taskRaw = await kvGet('task:' + taskId);
  if (!taskRaw) return res.status(404).json({ error: 'task ' + taskId + ' not found' });
  const task = typeof taskRaw === 'string' ? JSON.parse(taskRaw) : taskRaw;

  const fail = async (reason) => {
    await kvSet('task:' + taskId, JSON.stringify({
      ...task, status: 'failed', failReason: reason, updatedAt: new Date().toISOString()
    }));
    return res.status(422).json({ error: reason });
  };

  // ── TOKEN LOAD: canonical key first, fall back to legacy ────────────────────────────────────────────────
  let tokensRaw = await kvGet(KV_TOKENS_KEY);
  if (!tokensRaw) {
    const legacyRaw = await kvGet(KV_TOKENS_KEY_LEGACY);
    if (legacyRaw) {
      // Legacy tokens found — reject immediately; must re-auth with correct account
      return res.status(400).json({
        error: `Gmail connected with wrong/unverified account. Please re-authenticate at /api/auth/init with ${CANONICAL_SENDER}.`
      });
    }
  }
  if (!tokensRaw) return fail('Gmail not connected - visit /api/auth/init to connect.');

  let tokens = typeof tokensRaw === 'string' ? JSON.parse(tokensRaw) : tokensRaw;

  // ── TOKEN ACCOUNT GUARD: stored email must be in the allowed accounts list ──────────────────────────────────────────────
  if (tokens.email && !isAllowedAccount(tokens.email)) {
    return res.status(400).json({
      error: `Tokens are for ${tokens.email}, which is not in the allowed accounts list. Re-auth at /api/auth/init.`
    });
  }

  // ── REFRESH if expired ──────────────────────────────────────────────────────────────────────────────────
  let { access_token: atk, expiry_date } = tokens;
  if (!atk || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) return fail('No Gmail refresh token - re-auth at /api/auth/init.');
    const rr = await refreshToken(tokens.refresh_token);
    if (rr.status >= 300 || rr.body.error) return fail('Token refresh failed: ' + JSON.stringify(rr.body));
    atk = rr.body.access_token;
    tokens = { ...tokens, access_token: atk, expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000 };
    await kvSet(KV_TOKENS_KEY, JSON.stringify(tokens));
  }

  // ── SEND ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ep = task.payload || directPayload || {};
  if (!ep.to) return fail('payload.to is required');

  let to;
  try {
    to = await resolveRecipient(ep.to, { inquiry: ep.inquiry, testOverride: ep.testOverride });
  } catch (e) {
    return fail(e.message);
  }
  const result = await sendEmail(atk, to, ep.subject || '(no subject)', ep.body || '');
  if (result.status >= 300) return fail('Gmail API ' + result.status + ': ' + JSON.stringify(result.body).slice(0, 200));

  await kvSet('task:' + taskId, JSON.stringify({
    ...task,
    status: 'sent',
    gmailMessageId: result.body.id,
    sentFrom: CANONICAL_SENDER,
    sentAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  return res.status(200).json({ ok: true, taskId, gmailMessageId: result.body.id, sentFrom: CANONICAL_SENDER });
};

module.exports.resolveRecipient = resolveRecipient;
