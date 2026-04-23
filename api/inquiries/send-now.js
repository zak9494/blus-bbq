/**
 * POST /api/inquiries/send-now
 * R4-1 Phases 7 & 8 — Direct KV-token Gmail send. Secret-gated.
 * Sender locked to info@blusbarbeque.com.
 *
 * Body: { to, subject, body, name?, quote? }
 *   If quote is provided (quote mode), attaches a PDF and sends a cover-note body.
 * Returns: { ok, messageId, sentFrom }
 */

module.exports.config = { maxDuration: 20 };

const https = require('https');
const { generateQuotePDF } = require('../_lib/pdf-gen');
const { businessConfig } = require('../_lib/business-config.js');

const CANONICAL_SENDER = businessConfig.email;
const KV_TOKENS_KEY = 'gmail:' + CANONICAL_SENDER;
const BOUNDARY = 'BLUS_BBQ_MIME_BOUNDARY_42';

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + token } }, r => {
      let d = '';
      r.on('data', c => d += c);
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
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                          catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function secretGate(req, res) {
  const secret   = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function getKVTokens() {
  let raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('Gmail not connected — visit /api/auth/init to connect ' + CANONICAL_SENDER);
  let tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (tokens.email && tokens.email !== CANONICAL_SENDER)
    throw new Error('Sender locked to ' + CANONICAL_SENDER + '. Tokens are for ' + tokens.email + '. Re-auth required.');
  let { access_token: atk, expiry_date } = tokens;
  if (!atk || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) throw new Error('No refresh token — re-auth at /api/auth/init');
    const rr = await httpsPost('oauth2.googleapis.com', '/token',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({
        client_id:     process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type:    'refresh_token'
      }).toString()
    );
    if (rr.status >= 300 || rr.body.error)
      throw new Error('Token refresh failed: ' + JSON.stringify(rr.body).slice(0, 200));
    atk = rr.body.access_token;
    tokens = { ...tokens, access_token: atk, expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000 };
    await kvSet(KV_TOKENS_KEY, JSON.stringify(tokens));
  }
  return atk;
}

/**
 * Wrap base64 string at 76 chars per line (MIME requirement).
 */
function wrapBase64(b64) {
  return b64.match(/.{1,76}/g).join('\r\n');
}

/**
 * Build a plain-text MIME message (no attachment).
 */
function buildPlainMIME(toHeader, subject, textBody) {
  const lines = [
    'From: ' + businessConfig.name + ' <' + CANONICAL_SENDER + '>',
    'To: ' + toHeader,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    textBody
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

/**
 * Build a multipart/mixed MIME message with a plain-text body and PDF attachment.
 */
function buildMultipartMIME(toHeader, subject, textBody, pdfBuf, filename) {
  const b64pdf = wrapBase64(pdfBuf.toString('base64'));
  const lines = [
    'From: ' + businessConfig.name + ' <' + CANONICAL_SENDER + '>',
    'To: ' + toHeader,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + BOUNDARY + '"',
    '',
    '--' + BOUNDARY,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    textBody,
    '',
    '--' + BOUNDARY,
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="' + filename + '"',
    '',
    b64pdf,
    '',
    '--' + BOUNDARY + '--'
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const { to, subject, body: emailBody, name, quote } = body;
  if (!to || !subject || !emailBody) return res.status(400).json({ error: 'to, subject, and body are required' });

  let atk;
  try { atk = await getKVTokens(); }
  catch (e) { return res.status(401).json({ error: e.message, needsAuth: true }); }

  const toHeader = (name && name.trim()) ? name.trim() + ' <' + to + '>' : to;

  let raw;
  if (quote && quote.line_items && quote.line_items.length) {
    // Generate PDF and send as attachment
    try {
      const pdfBuf = generateQuotePDF(quote, name || '');
      const firstName = (name || '').split(' ')[0] || '';
      const filename = 'Blus-BBQ-Quote' + (firstName ? '-' + firstName : '') + '.pdf';
      raw = buildMultipartMIME(toHeader, subject, emailBody, pdfBuf, filename);
    } catch (pdfErr) {
      // Fallback: send plain text if PDF generation fails
      console.error('PDF gen failed, falling back to plain text:', pdfErr.message);
      raw = buildPlainMIME(toHeader, subject, emailBody);
    }
  } else {
    raw = buildPlainMIME(toHeader, subject, emailBody);
  }

  try {
    const result = await httpsPost(
      'gmail.googleapis.com',
      '/gmail/v1/users/me/messages/send',
      { Authorization: 'Bearer ' + atk, 'Content-Type': 'application/json' },
      JSON.stringify({ raw })
    );
    if (result.status >= 300) {
      return res.status(500).json({ error: 'Gmail API error ' + result.status, detail: JSON.stringify(result.body).slice(0, 300) });
    }
    return res.status(200).json({ ok: true, messageId: result.body.id, sentFrom: CANONICAL_SENDER });
  } catch (e) {
    return res.status(500).json({ error: 'Send failed', detail: e.message });
  }
};
