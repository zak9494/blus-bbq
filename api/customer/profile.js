/* ===== MODULE: CUSTOMER PROFILE
   GET /api/customer/profile?email=...
   Aggregates all past inquiries, quotes, emails, and notes for a customer email.
   Auth: ?secret=GMAIL_READ_SECRET
   Returns: { ok, customer: { email, name, phone, events[], totalBilled, totalEvents }, notes }
   ===== */
'use strict';
const https = require('https');

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

function normalizeEmail(e) { return (e || '').toLowerCase().trim(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret   = (req.query || {}).secret;
  const expected = process.env.GMAIL_READ_SECRET;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const email = normalizeEmail((req.query || {}).email);
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    // Load inquiries index
    const rawIdx = await kvGet('inquiries:index');
    const index  = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];

    // Match inquiries to this email
    const matches = (Array.isArray(index) ? index : []).filter(item => {
      const itemEmail = normalizeEmail(item.email || item.from || item.customer_email || '');
      const extractedEmail = normalizeEmail(item.extracted_email || '');
      return itemEmail.includes(email) || extractedEmail.includes(email) ||
             email.includes(itemEmail.split('@')[0] || '___NOMATCH___');
    });

    // Load full records for matched inquiries (up to 30)
    const fullRecords = await Promise.all(
      matches.slice(0, 30).map(async item => {
        try {
          const raw = await kvGet('inquiries:' + item.threadId);
          if (!raw) return null;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { return null; }
      })
    );
    const records = fullRecords.filter(Boolean);

    // Aggregate customer identity from most recent record
    const recent = records.sort((a, b) => new Date(b.storedAt || b.created_at || 0) - new Date(a.storedAt || a.created_at || 0))[0] || {};
    const ef = recent.extracted_fields || {};

    const customerName  = ef.customer_name || recent.name || recent.customer_name || '';
    const customerPhone = ef.customer_phone || recent.phone || '';

    // Build events list
    const events = records.map(r => {
      const f = r.extracted_fields || {};
      const q = r.quote || {};
      return {
        threadId:    r.threadId,
        subject:     r.subject || '',
        eventDate:   f.event_date || r.event_date || '',
        eventType:   f.event_type || '',
        guestCount:  f.guest_count || r.guest_count || null,
        status:      r.status || 'new',
        quoteTotal:  q.total || r.quote_total || null,
        storedAt:    r.storedAt || r.created_at || '',
        approved:    r.approved || false,
        menuItems:   (q.line_items || []).map(li => li.name || li.item_name || ''),
        serviceType: f.service_type || q.service_type || '',
        notes:       r.notes || '',
      };
    }).sort((a, b) => new Date(b.storedAt || 0) - new Date(a.storedAt || 0));

    const totalBilled = events.reduce((sum, e) => sum + (parseFloat(e.quoteTotal) || 0), 0);

    // Load customer notes
    const notesRaw = await kvGet('customer:' + email + ':notes');
    const notes = typeof notesRaw === 'string' ? notesRaw : (notesRaw ? JSON.stringify(notesRaw) : '');

    return res.status(200).json({
      ok: true,
      customer: {
        email,
        name:        customerName,
        phone:       customerPhone,
        totalEvents: events.length,
        totalBilled: Math.round(totalBilled * 100) / 100,
        events,
      },
      notes,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
