/* ===== MODULE: DUPLICATE QUOTE
   POST /api/quotes/duplicate
   Body: { secret, threadId }
   Copies all line items, guest count, service type, and menu items from the
   source inquiry's quote into a new draft inquiry (status=needs_info).
   Returns: { ok, newThreadId, quote }
   ===== */
'use strict';
const https  = require('https');
const crypto = require('crypto');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body     = req.body || {};
  const secret   = body.secret;
  const expected = process.env.GMAIL_READ_SECRET;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId } = body;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  try {
    // Load source inquiry
    const raw = await kvGet('inquiries:' + threadId);
    if (!raw) return res.status(404).json({ error: 'Inquiry not found: ' + threadId });
    const src = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const srcQuote = src.quote || {};
    const srcFields = src.extracted_fields || {};

    // Build duplicated quote — reset totals since prices may have changed
    const newQuote = {
      line_items:         srcQuote.line_items || [],
      service_charge_pct: srcQuote.service_charge_pct || 20,
      delivery_fee:       srcQuote.delivery_fee || 0,
      notes:              srcQuote.notes || '',
      unresolved_preferences: srcQuote.unresolved_preferences || [],
      needs_customer_input:   true,
      duplicated_from:        threadId,
      duplicated_at:          new Date().toISOString(),
    };

    // New draft inquiry
    const newId  = 'dup-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const now    = new Date().toISOString();
    const newInq = {
      threadId:         newId,
      subject:          'Duplicate: ' + (src.subject || ''),
      from:             src.from || '',
      status:           'needs_info',
      approved:         false,
      created_at:       now,
      storedAt:         now,
      updated_at:       now,
      source:           src.source || 'manual',
      quote:            newQuote,
      extracted_fields: {
        customer_name:         srcFields.customer_name || src.customer_name || '',
        customer_email:        srcFields.customer_email || src.customer_email || '',
        customer_phone:        srcFields.customer_phone || src.customer_phone || '',
        event_date:            '',  // user must fill in new event date
        event_time:            srcFields.event_time || '',
        event_type:            srcFields.event_type || '',
        guest_count:           srcFields.guest_count || null,
        venue_name:            srcFields.venue_name || '',
        venue_address:         srcFields.venue_address || '',
        menu_preferences:      srcFields.menu_preferences || [],
        dietary_restrictions:  srcFields.dietary_restrictions || [],
        service_type:          srcFields.service_type || 'pickup',
        budget:                null,
        special_requests:      '',
      },
      history: [{ action: 'duplicated_from', source_threadId: threadId, actor: 'user', at: now }],
    };

    await kvSet('inquiries:' + newId, newInq);

    // Update index
    const idxRaw = await kvGet('inquiries:index');
    let idx = idxRaw ? (typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw) : [];
    if (!Array.isArray(idx)) idx = [];
    idx.unshift({
      threadId:      newId,
      subject:       newInq.subject,
      from:          newInq.from,
      status:        newInq.status,
      storedAt:      now,
      name:          newInq.extracted_fields.customer_name,
      email:         newInq.extracted_fields.customer_email,
      event_date:    '',
      quote_total:   null,
      approved:      false,
      source:        newInq.source,
    });
    if (idx.length > 500) idx = idx.slice(0, 500);
    await kvSet('inquiries:index', idx);

    return res.status(200).json({ ok: true, newThreadId: newId, quote: newQuote });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
