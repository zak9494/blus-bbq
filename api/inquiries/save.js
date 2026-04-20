/* ===== MODULE: INQUIRIES SAVE (C20)
   POST /api/inquiries/save
   Body: { secret, customer_name, email, event_date, event_time, guest_count,
           service_type, delivery_address, notes, quote }
   Creates a new inquiry in KV from Quote Builder data.
   KV keys written:
     inquiries:index  (append summary entry)
     inquiry:{threadId}  (full detail)
   ===== */
'use strict';
const https = require('https');
const crypto = require('crypto');

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

async function kvPipeline(commands) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const body = JSON.stringify(commands);
    const u = new URL(url + '/pipeline');
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const secret   = body.secret;
  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const {
    customer_name, email, event_date, event_time, guest_count,
    service_type, delivery_address, notes, quote,
  } = body;

  if (!customer_name) return res.status(400).json({ error: 'customer_name is required' });

  const now       = new Date().toISOString();
  const rand      = crypto.randomBytes(4).toString('hex');
  const threadId  = 'qb-' + Date.now() + '-' + rand;
  const fromAddr  = email ? customer_name + ' <' + email + '>' : customer_name;
  const subject   = 'Quote for ' + customer_name + (event_date ? ' (' + event_date + ')' : '');
  const bodyText  = [
    'Created manually from Quote Builder.',
    guest_count   ? 'Guests: ' + guest_count               : '',
    service_type  ? 'Service: ' + service_type             : '',
    delivery_address ? 'Address: ' + delivery_address       : '',
    notes         ? 'Notes: ' + notes                      : '',
  ].filter(Boolean).join('\n');

  const indexEntry = {
    threadId,
    customer_name,
    from:      fromAddr,
    email:     email || '',
    source:    'direct',
    status:    quote && quote.line_items && quote.line_items.length ? 'quote_drafted' : 'new',
    event_date: event_date || '',
    guest_count: guest_count || null,
    subject,
    storedAt:  now,
    approved:  false,
    has_unreviewed_update: false,
    quote_total: quote && quote.grand_total ? quote.grand_total : null,
  };

  const fullInquiry = {
    ...indexEntry,
    body:       bodyText,
    event_time: event_time || '',
    delivery_address: delivery_address || '',
    notes:      notes || '',
    source:     'direct',
    extracted_fields: {
      customer_name,
      customer_email: email || '',
      event_date:    event_date || '',
      event_time:    event_time || '',
      guest_count:   guest_count || null,
      service_type:  service_type || 'pickup',
      delivery_address: delivery_address || '',
      notes:         notes || '',
    },
    quote: quote || null,
    activity_log: [],
  };

  try {
    // Load existing index, append, save
    const indexRaw = await kvGet('inquiries:index');
    const index    = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];
    index.unshift(indexEntry); // newest first

    await kvPipeline([
      ['SET', 'inquiries:index',    JSON.stringify(index)],
      ['SET', 'inquiry:' + threadId, JSON.stringify(fullInquiry)],
    ]);

    return res.status(200).json({ ok: true, threadId });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
