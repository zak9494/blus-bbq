/* ===== MODULE: OVERDUE WIDGET
   GET /api/pipeline/overdue?secret=...
   Returns three lists of overdue items:
     - unanswered_quotes: quotes sent >5 days ago with no reply
     - deposits_due:      inquiries with a deposit schedule where next due date is past & unpaid
     - missing_headcount: events within 7 days where final_guest_count is null
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

const MS_PER_DAY = 86400000;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

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

  try {
    const rawIdx = await kvGet('inquiries:index');
    const index  = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];
    const now    = Date.now();

    const unanswered_quotes  = [];
    const deposits_due       = [];
    const missing_headcount  = [];

    for (const item of (Array.isArray(index) ? index : [])) {
      if (item.status === 'archived') continue;

      const name        = item.name || item.customer_name || item.from || 'Unknown';
      const customerEmail = item.email || item.customer_email || '';
      const eventDate   = parseDate(item.event_date || item.eventDate);
      const threadId    = item.threadId;

      // ── 1. Unanswered quotes: status=quote_sent, no reply in >5 days ──────────
      if (item.status === 'quote_sent') {
        const sentAt = parseDate(item.quote_sent_at || item.updated_at || item.storedAt);
        if (sentAt && (now - sentAt.getTime()) > 5 * MS_PER_DAY && !item.has_customer_reply) {
          unanswered_quotes.push({
            threadId, name, customerEmail,
            eventDate: item.event_date || item.eventDate || '',
            daysSinceSent: Math.floor((now - sentAt.getTime()) / MS_PER_DAY),
            quoteTotal: item.quote_total || item.quoteTotal || null,
          });
        }
      }

      // ── 2. Deposits due: load deposit records and check for past-due unpaid ──
      if (item.status === 'booked' || item.status === 'quote_sent') {
        try {
          const depRaw = await kvGet('deposits:' + threadId);
          const deps   = depRaw ? (typeof depRaw === 'string' ? JSON.parse(depRaw) : depRaw) : [];
          if (Array.isArray(deps)) {
            for (const dep of deps) {
              if (dep.paid) continue;
              const dueDate = parseDate(dep.due_date);
              if (dueDate && dueDate.getTime() < now) {
                deposits_due.push({
                  threadId, name, customerEmail,
                  eventDate: item.event_date || item.eventDate || '',
                  depositLabel:   dep.label || 'Deposit',
                  depositAmount:  dep.amount || null,
                  daysOverdue:    Math.floor((now - dueDate.getTime()) / MS_PER_DAY),
                });
                break; // one entry per inquiry
              }
            }
          }
        } catch { /* skip deposit check failure */ }
      }

      // ── 3. Missing headcount: event within 7 days, final_guest_count null ────
      if (eventDate) {
        const msUntil = eventDate.getTime() - now;
        if (msUntil > 0 && msUntil < 7 * MS_PER_DAY) {
          const hasFinalCount = !!(item.final_guest_count || item.finalGuestCount);
          if (!hasFinalCount && item.status !== 'archived') {
            missing_headcount.push({
              threadId, name, customerEmail,
              eventDate:   item.event_date || item.eventDate || '',
              daysUntil:   Math.floor(msUntil / MS_PER_DAY),
              guestCount:  item.guest_count || item.guestCount || null,
            });
          }
        }
      }
    }

    const total = unanswered_quotes.length + deposits_due.length + missing_headcount.length;

    return res.status(200).json({
      ok: true,
      total,
      unanswered_quotes:  unanswered_quotes.sort((a, b) => b.daysSinceSent - a.daysSinceSent),
      deposits_due:       deposits_due.sort((a, b) => b.daysOverdue - a.daysOverdue),
      missing_headcount:  missing_headcount.sort((a, b) => a.daysUntil - b.daysUntil),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
