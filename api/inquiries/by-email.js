/* ===== MODULE: INQUIRIES BY EMAIL
   GET /api/inquiries/by-email?secret=...&email=...
   Returns all inquiries with a matching customer email, sorted desc by storedAt.
   Used by repeat-customer.js to detect returning customers.
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secret   = q.secret;
  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const email = (q.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email is required' });

  // Exclude this threadId from results (caller passes it to avoid self-match)
  const excludeId = q.excludeThreadId || '';

  try {
    // Load the inquiries index
    const indexRaw = await kvGet('inquiries:index');
    const index    = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];

    const matches = index
      .filter(function(item) {
        if (item.threadId === excludeId) return false;
        // Match on stored email field or extracted_fields.customer_email
        const itemEmail = ((item.email || item.from || '') + ' ' +
                           (item.customer_email || '')).toLowerCase();
        return itemEmail.includes(email);
      })
      .sort(function(a, b) {
        return new Date(b.storedAt || 0) - new Date(a.storedAt || 0);
      })
      .slice(0, 10) // cap at 10 prior events
      .map(function(item) {
        return {
          threadId:     item.threadId,
          customerName: item.name || item.customer_name || '',
          eventDate:    item.event_date || item.eventDate || '',
          status:       item.status || 'new',
          quoteTotal:   item.quote_total || item.quoteTotal || null,
          storedAt:     item.storedAt || '',
          subject:      item.subject || '',
        };
      });

    return res.status(200).json({ ok: true, matches, count: matches.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
