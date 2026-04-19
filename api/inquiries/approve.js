/**
 * POST /api/inquiries/approve
 * Two-stage system — Approve an inquiry from Stage 1 → Stage 2 (Pipeline).
 *
 * Sets approved: true. Triggers AI quote gen if not already present and canQuote.
 *
 * Body: { threadId }
 * Returns: { ok, threadId, quote_generated }
 */
module.exports.config = { maxDuration: 30 };

const https = require('https');
const APP_URL = process.env.APP_URL || 'https://blus-bbq.vercel.app';

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

function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
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

  // Load existing record
  const raw = await kvGet('inquiries:' + threadId);
  if (!raw) return res.status(404).json({ error: 'Inquiry not found', threadId });
  const inq = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Try AI quote gen if not already present and we have enough info
  let quote = inq.quote || null;
  let quoteGenerated = false;
  if (!quote) {
    const ef = inq.extracted_fields || {};
    const canQuote = ef.guest_count && ef.menu_preferences && ef.menu_preferences.length;
    if (canQuote) {
      const serviceType = /delivery.*setup|setup.*delivery|full.service/i.test(ef.special_requests || '')
        ? 'delivery_setup' : /delivery/i.test(ef.special_requests || '') ? 'delivery' : 'pickup';
      const qr = await callInternal('/api/quotes/ai-generate', 'POST', { ...ef, service_type: serviceType });
      if (qr.status < 300 && qr.body.ok) { quote = qr.body.quote; quoteGenerated = true; }
    }
  }

  // Determine pipeline status
  const PIPELINE_STATUSES = ['needs_info','quote_drafted','quote_approved','quote_sent','booked','declined'];
  const newStatus = quote ? 'quote_drafted' : (PIPELINE_STATUSES.includes(inq.status) ? inq.status : 'needs_info');

  // Save: set approved:true + new status + quote if generated
  const saveResp = await callInternal('/api/inquiries/save', 'POST', {
    threadId,
    approved: true,
    status: newStatus,
    ...(quoteGenerated ? { quote } : {}),
    history_entry: { action: 'approved_to_pipeline' + (quoteGenerated ? '_with_quote' : ''), actor: 'user' }
  });
  if (saveResp.status >= 300) return res.status(500).json({ error: 'Save failed', detail: saveResp.body });

  return res.status(200).json({ ok: true, threadId, quote_generated: quoteGenerated, status: newStatus });
};
