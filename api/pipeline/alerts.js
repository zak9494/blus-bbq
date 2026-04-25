/* ===== MODULE: PIPELINE ALERTS
   GET /api/pipeline/alerts?secret=...
   Generates rule-based alerts from live KV inquiry data.
   Alert rules:
     - past_due:     event_date < today && status NOT IN [completed, declined]
     - stale_reply:  last_activity > 3 days ago && status IN [quote_sent, needs_info]
     - unpaid_bal:   status = booked && balance_due > 0 && event_date < today+3d
     - upcoming_48h: event_date within 48h && status = booked
   ===== */
'use strict';
const https = require('https');

// Dashboard access secret — same value embedded in index.html (not a server secret).
// Accepted alongside SELF_MODIFY_SECRET so the pipeline alerts banner works on Kanban + List views.
const INQ_SECRET = 'c857eb539774b63cf0b0a09303adc78d';

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

function parseDate(s) {
  if (!s) return null;
  try {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secret       = q.secret;
  const serverSecret = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const isValid      = secret === INQ_SECRET || (serverSecret && secret === serverSecret);
  if (!isValid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const indexRaw = await kvGet('inquiries:index');
    const index    = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];

    const now       = new Date();
    const todayMs   = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const threeDays = 3 * 24 * 3600 * 1000;
    const staleMs   = 3 * 24 * 3600 * 1000;

    const TERMINAL = new Set(['completed', 'declined']);
    const STALE_STATUSES = new Set(['quote_sent', 'needs_info', 'approved']);

    const alerts = [];

    for (const item of index) {
      const status    = item.status || 'new';
      const name      = item.name || item.customer_name || 'Unknown';
      const threadId  = item.threadId;
      const eventDate = parseDate(item.event_date || item.eventDate);
      const eventMs   = eventDate ? eventDate.getTime() : null;

      // Past-due: event has passed, not terminal
      if (eventMs && eventMs < todayMs && !TERMINAL.has(status)) {
        const days = Math.floor((todayMs - eventMs) / 86400000);
        alerts.push({
          type: 'past_due',
          severity: 'high',
          threadId,
          name,
          message: name + ' \u2014 event was ' + days + ' day' + (days === 1 ? '' : 's') + ' ago (' + (item.event_date || '') + ')',
          label: 'Past Due',
          eventDate: item.event_date || '',
          status,
        });
      }

      // Upcoming in 48h and booked
      if (eventMs && eventMs >= todayMs && eventMs < todayMs + 2 * 24 * 3600 * 1000 && status === 'booked') {
        const hrs = Math.floor((eventMs - Date.now()) / 3600000);
        alerts.push({
          type: 'upcoming_48h',
          severity: 'medium',
          threadId,
          name,
          message: name + ' \u2014 event in ~' + hrs + 'h (' + (item.event_date || '') + ')',
          label: 'Upcoming',
          eventDate: item.event_date || '',
          status,
        });
      }

      // Stale reply: last activity > 3 days, waiting statuses
      if (STALE_STATUSES.has(status)) {
        const lastAct = item.last_activity_at || item.updatedAt || item.storedAt;
        if (lastAct) {
          const ageMs = Date.now() - new Date(lastAct).getTime();
          if (ageMs > staleMs) {
            const days = Math.floor(ageMs / 86400000);
            alerts.push({
              type: 'stale_reply',
              severity: 'medium',
              threadId,
              name,
              message: name + ' \u2014 no activity for ' + days + ' day' + (days === 1 ? '' : 's'),
              label: 'Stale',
              eventDate: item.event_date || '',
              status,
            });
          }
        }
      }

      // Unpaid balance: booked, event in <3 days, balance_due > 0
      if (status === 'booked' && eventMs && eventMs < todayMs + threeDays && eventMs >= todayMs) {
        const balDue = parseFloat(item.balance_due || 0);
        if (balDue > 0) {
          alerts.push({
            type: 'unpaid_bal',
            severity: 'high',
            threadId,
            name,
            message: name + ' \u2014 $' + balDue.toFixed(2) + ' balance due, event ' + (item.event_date || 'soon'),
            label: 'Unpaid Balance',
            eventDate: item.event_date || '',
            status,
          });
        }
      }
    }

    // Sort: high severity first, then by eventDate asc
    alerts.sort(function(a, b) {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
      return (a.eventDate || '').localeCompare(b.eventDate || '');
    });

    return res.status(200).json({ ok: true, alerts, count: alerts.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
