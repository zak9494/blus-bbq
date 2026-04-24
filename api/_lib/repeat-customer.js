/**
 * Repeat-customer detection library.
 * Given an email address, reads from existing KV inquiry records and returns
 * { status, count, bookedCount, lastEventDate, lastAmount }
 * without duplicating any data.
 *
 * status: 'none' | 'prior_inquiry' | 'booked_and_paid'
 *
 * Cache: in-memory Map keyed by email, 60-second TTL (per serverless invocation).
 */

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

// In-process cache: email → { data, expiresAt }
const _cache = new Map();
const TTL_MS = 60_000;

function normalize(email) {
  return (email || '').toLowerCase().trim();
}

function extractEmail(inq) {
  if (inq.extracted_fields && inq.extracted_fields.customer_email) {
    return normalize(inq.extracted_fields.customer_email);
  }
  const from = inq.from || '';
  const m = from.match(/<(.+?)>/);
  return m ? normalize(m[1]) : normalize(from);
}

/**
 * Returns repeat-customer info for an email address.
 * excludeThreadId: omit the current inquiry from results.
 */
async function lookup(email, excludeThreadId) {
  const key = normalize(email);
  if (!key) return { status: 'none', count: 0, bookedCount: 0 };

  const cacheKey = key + (excludeThreadId || '');
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Read the inquiries index
  let index = [];
  try {
    const raw = await kvGet('inquiries:index');
    index = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
  } catch (_) {}

  const matches = index.filter(inq => {
    if (excludeThreadId && inq.threadId === excludeThreadId) return false;
    if (inq.status === 'archived') return false;
    const em = extractEmail(inq);
    return em && em === key;
  });

  let bookedCount = 0;
  let lastEventDate = null;
  let lastAmount = null;

  for (const m of matches) {
    if (m.status === 'completed') {
      bookedCount++;
      if (m.event_date && (!lastEventDate || m.event_date > lastEventDate)) {
        lastEventDate = m.event_date;
        lastAmount = m.quote_total ? parseFloat(m.quote_total) : null;
      }
    } else if (!lastEventDate && m.event_date) {
      lastEventDate = m.event_date;
    }
  }

  const count = matches.length;
  let status = 'none';
  if (bookedCount > 0) status = 'booked_and_paid';
  else if (count > 0) status = 'prior_inquiry';

  const data = { status, count, bookedCount, lastEventDate, lastAmount };
  _cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });
  return data;
}

module.exports = { lookup };
