/* ===== TEST INQUIRY ENDPOINT
   POST /api/inquiries/test
   Creates a fake inquiry for QA purposes.
   Auth: body.secret === SELF_MODIFY_SECRET

   Safety invariants:
   - threadId always starts with 'test-' so all dashboard filters exclude it by default
   - test: true flag on the record so dispatch/email.js can intercept and redirect recipients
   - Email fields always use the test address (zak9494+bbqtest@gmail.com), never a real customer
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

const INDEX_KEY = 'inquiries:index';
const MAX_INDEX = 500;
const TEST_EMAIL = 'zak9494+bbqtest@gmail.com';

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvSet(key, value) {
  const url = kvUrl(), tok = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { r.statusCode >= 300 ? reject(new Error('KV HTTP ' + r.statusCode)) : resolve(); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function futureDate(daysOut) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().split('T')[0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const body = req.body || {};
  if (!expected || body.secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now       = new Date().toISOString();
  const threadId  = 'test-' + Date.now();
  const eventDate = futureDate(14);

  const record = {
    threadId,
    test: true,
    messageId:  threadId,
    subject:    '[TEST] Catering Inquiry — BBQ Party 25 guests',
    from:       'Test Customer <' + TEST_EMAIL + '>',
    date:       now,
    email_date: now,
    status:     'new',
    source:     'direct',
    approved:   false,
    has_unreviewed_update: false,
    created_at: now,
    updated_at: now,
    extracted_fields: {
      customer_name: 'Test Customer',
      customer_email: TEST_EMAIL,
      customer_phone: '555-010-0000',
      event_date:    eventDate,
      event_time:    '2:00 PM',
      guest_count:   25,
      event_type:    'Birthday Party',
      event_address: '123 Test St, Dallas TX 75201',
      menu_requests: 'Brisket, ribs, sides — standard BBQ spread',
      budget:        null,
      notes:         'This is a test inquiry created by test customer mode. No real customer involved.',
    },
    customer_name:  'Test Customer',
    customer_email: TEST_EMAIL,
    customer_phone: '555-010-0000',
    event_date:     eventDate,
    guest_count:    25,
  };

  try {
    // Write full record
    await kvSet('inquiries:' + threadId, record);

    // Update index
    const rawIdx = await kvGet(INDEX_KEY).catch(() => null);
    let index = [];
    try { index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { index = []; }
    if (!Array.isArray(index)) index = [];

    const summary = {
      threadId,
      test: true,
      subject:       record.subject,
      from:          record.from,
      date:          now,
      email_date:    now,
      status:        'new',
      source:        'direct',
      approved:      false,
      has_unreviewed_update: false,
      customer_name: 'Test Customer',
      event_date:    eventDate,
      guest_count:   25,
    };
    index = [summary, ...index.filter(i => i.threadId !== threadId)];
    if (index.length > MAX_INDEX) index = index.slice(0, MAX_INDEX);
    await kvSet(INDEX_KEY, index);

    return res.status(200).json({ ok: true, threadId, record });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Exported for unit-testing the safety logic
module.exports.TEST_EMAIL = TEST_EMAIL;
