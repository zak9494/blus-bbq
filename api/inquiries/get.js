/**
 * GET /api/inquiries/get?threadId={threadId}
 * R4-1 Phase 4 — Returns a single full inquiry record.
 *
 * Returns: { ok, inquiry: { threadId, messageId, raw_email, subject, from, date,
 *             extracted_fields, quote, status, created_at, updated_at, history } }
 */

module.exports.config = { maxDuration: 15 };


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
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
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
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

const VALID_STATUSES = ['new','needs_info','quote_drafted','quote_approved','quote_sent','booked','declined'];

const INDEX_KEY = 'inquiries:index';
const MAX_INDEX = 500;

function recordKey(threadId) { return 'inquiries:' + threadId; }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretGate(req, res)) return;

  const threadId = req.query && req.query.threadId;
  if (!threadId) return res.status(400).json({ error: 'threadId query param required' });

  let raw;
  try { raw = await kvGet(recordKey(threadId)); } catch (e) {
    return res.status(500).json({ error: 'KV read failed', detail: e.message });
  }

  if (!raw) return res.status(404).json({ error: 'Inquiry not found', threadId });

  const inquiry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return res.status(200).json({ ok: true, inquiry });
};
