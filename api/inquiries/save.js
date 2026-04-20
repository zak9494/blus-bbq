/* ===== MODULE: INQUIRIES SAVE
   POST /api/inquiries/save

   Two call formats:

   A) Quote Builder / UI  (SELF_MODIFY_SECRET in body.secret):
      Body: { secret, customer_name, email, event_date, event_time, guest_count,
              service_type, delivery_address, notes, quote }

   B) Cron ingestion  (GMAIL_READ_SECRET in ?secret= query param):
      Body: { threadId, messageId, subject, from, date, raw_email,
              extracted_fields, quote, status, source, approved, history_entry }

   KV keys written:
     inquiries:index         (prepend/replace summary entry)
     inquiry:{threadId}      (full detail)
===== */
'use strict';
const https  = require('https');
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

  // ââ Auth ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // Format A: secret in body, checked against SELF_MODIFY_SECRET (Quote Builder / UI)
  // Format B: secret in ?secret= query param, checked against GMAIL_READ_SECRET (cron)
  const bodySecret    = body.secret;
  const querySecret   = (req.query && req.query.secret) || req.headers['x-secret'];
  const selfModSecret = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const gmailSecret   = process.env.GMAIL_READ_SECRET;

  const isUiCall   = selfModSecret && bodySecret  === selfModSecret;
  const isCronCall = gmailSecret   && querySecret === gmailSecret;

  if (!isUiCall && !isCronCall) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();
  let indexEntry, fullInquiry;

  if (isCronCall && body.extracted_fields) {
    // ââ Format B: cron ingestion from poll-inquiries ââââââââââââââââââââââââââ
    const {
      threadId, messageId, subject, from: fromAddr, date,
      raw_email, extracted_fields: ef, quote, status, source,
      approved = false, history_entry,
    } = body;

    if (!threadId) return res.status(400).json({ error: 'threadId is required for cron saves' });

    indexEntry = {
      threadId,
      customer_name:  ef.customer_name   || '',
      from:           fromAddr            || '',
      email:          ef.customer_email   || '',
      source:         source              || 'email',
      status:         status              || 'new',
      event_date:     ef.event_date       || '',
      guest_count:    ef.guest_count      || null,
      subject:        subject             || '',
      storedAt:       now,
      approved:       !!approved,
      has_unreviewed_update: false,
      quote_total:    quote && quote.grand_total ? quote.grand_total : null,
    };

    fullInquiry = {
      ...indexEntry,
      messageId:        messageId                               || '',
      date:             date                                    || '',
      body:             raw_email && raw_email.body ? raw_email.body : '',
      event_time:       ef.event_time                           || '',
      delivery_address: ef.delivery_address                    || '',
      notes:            ef.special_requests                    || '',
      service_type:     ef.service_type                         || 'pickup',
      raw_email:        raw_email                              || null,
      extracted_fields: ef,
      quote:            quote                                   || null,
      activity_log:     history_entry ? [history_entry] : [],
    };

  } else {
    // ââ Format A: Quote Builder / UI âââââââââââââââââââââââââââââââââââââââââ
    const {
      customer_name, email, event_date, event_time, guest_count,
      service_type, delivery_address, notes, quote,
    } = body;

    if (!customer_name) return res.status(400).json({ error: 'customer_name is required' });

    const rand     = crypto.randomBytes(4).toString('hex');
    const threadId = 'qb-' + Date.now() + '-' + rand;
    const fromAddr = email ? customer_name + ' <' + email + '>' : customer_name;
    const subject  = 'Quote for ' + customer_name + (event_date ? ' (' + event_date + ')' : '');
    const bodyText = [
      'Created manually from Quote Builder.',
      guest_count      ? 'Guests: '  + guest_count       : '',
      service_type     ? 'Service: ' + service_type      : '',
      delivery_address ? 'Address: ' + delivery_address : '',
      notes            ? 'Notes: '   + notes             : '',
    ].filter(Boolean).join('\n');

    indexEntry = {
      threadId,
      customer_name,
      from:       fromAddr,
      email:      email        || '',
      source:     'direct',
      status:     quote && quote.line_items && quote.line_items.length ? 'quote_drafted' : 'new',
      event_date: event_date   || '',
      guest_count: guest_count || null,
      subject,
      storedAt:   now,
      approved:   false,
      has_unreviewed_update: false,
      quote_total: quote && quote.grand_total ? quote.grand_total : null,
    };

    fullInquiry = {
      ...indexEntry,
      body:              bodyText,
      event_time:        event_time        || '',
      delivery_address:  delivery_address  || '',
      notes:             notes             || '',
      service_type:      service_type      || 'pickup',
      raw_email:         null,
      extracted_fields:  {
        customer_name,
        customer_email:   email            || '',
        event_date:       event_date       || '',
        event_time:       event_time       || '',
        guest_count:      guest_count      || null,
        service_type:     service_type     || 'pickup',
        delivery_address: delivery_address || '',
        notes:            notes            || '',
      },
      quote:             quote             || null,
      activity_log:      [],
    };
  }

  try {
    const indexRaw = await kvGet('inquiries:index');
    const index    = indexRaw
      ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw)
      : [];
    // Deduplicate: remove any existing entry for this threadId, then prepend
    const filtered = index.filter(e => e.threadId !== indexEntry.threadId);
    filtered.unshift(indexEntry);

    await kvPipeline([
      ['SET', 'inquiries:index',                 JSON.stringify(filtered)],
      ['SET', 'inquiry:' + indexEntry.threadId,  JSON.stringify(fullInquiry)],
    ]);

    return res.status(200).json({ ok: true, threadId: indexEntry.threadId });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
