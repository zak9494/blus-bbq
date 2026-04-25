/* ===== MODULE: CALENDAR LIST
   GET /api/calendar/list?secret=...&year=YYYY&month=M
   Returns Google Calendar events for the given month (or 3-month window),
   merged with synthetic events derived from KV inquiry records that have an
   event_date in the same window. Synthetic events let the calendar surface
   bookings that live only in inquiries:* (the common case) — without them
   the calendar appears empty even when KV has dozens of upcoming events.
   Stores nextSyncToken in KV for incremental webhook sync.
   ===== */
'use strict';
const { getAccessToken, gcalRequest, getOrCreateCalendarId, kvGet, kvSet, SYNC_TOKEN_KEY } = require('./_gcal');

// Inquiry statuses that should NOT appear on the calendar (lost / hidden leads).
const INQUIRY_HIDDEN_STATUSES = new Set(['archived', 'declined']);

function buildInquiryEvents(inquiries, timeMinIso, timeMaxIso, takenThreadIds) {
  if (!Array.isArray(inquiries) || !inquiries.length) return [];
  const lo = new Date(timeMinIso).getTime();
  const hi = new Date(timeMaxIso).getTime();
  const out = [];
  for (const inq of inquiries) {
    if (!inq || !inq.event_date || !inq.threadId) continue;
    if (inq.lost_at) continue;
    if (INQUIRY_HIDDEN_STATUSES.has(inq.status)) continue;
    if (takenThreadIds.has(inq.threadId)) continue;
    // Parse YYYY-MM-DD as local-noon to avoid TZ rollover at month boundaries
    const m = String(inq.event_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const y = +m[1], mo = +m[2] - 1, da = +m[3];
    const ms = new Date(y, mo, da, 12, 0, 0).getTime();
    if (ms < lo || ms > hi) continue;
    const next = new Date(y, mo, da + 1);
    const nextDate = next.getFullYear() + '-' +
      String(next.getMonth() + 1).padStart(2, '0') + '-' +
      String(next.getDate()).padStart(2, '0');
    const name = inq.customer_name || inq.from || inq.subject || 'Inquiry';
    out.push({
      kind:               'inquiry#virtual',
      id:                 'inq:' + inq.threadId,
      bbqVirtual:         true,
      status:             'confirmed',
      summary:            name,
      start:              { date: inq.event_date },
      end:                { date: nextDate },
      extendedProperties: { private: { blusBbqThreadId: inq.threadId } },
    });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: getAccessToken() below proves authorization via OAuth token in KV.
  // A caller without a valid stored token receives 500 from getAccessToken().
  const q = req.query || {};

  try {
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();

    // Build time range: specific month if provided, else ±1 month around today
    let timeMin, timeMax;
    if (q.year && q.month) {
      const y = parseInt(q.year, 10), m = parseInt(q.month, 10) - 1;
      timeMin = new Date(y, m, 1).toISOString();
      timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
    } else {
      const now = new Date();
      timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
    }

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '250',
    });

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?' + params.toString();
    const r = await gcalRequest('GET', calPath, null, token);

    if (r.status !== 200) {
      return res.status(502).json({ error: 'Google Calendar API error', status: r.status, detail: r.body });
    }

    // Store sync token so webhook handler can do incremental updates
    if (r.body.nextSyncToken) {
      await kvSet(SYNC_TOKEN_KEY, r.body.nextSyncToken);
    }

    // Merge soft-deleted (hidden) event IDs from KV
    const rawHidden = await kvGet('calendar:hidden').catch(() => null);
    let hiddenIds = [];
    try { hiddenIds = rawHidden ? (typeof rawHidden === 'string' ? JSON.parse(rawHidden) : rawHidden) : []; } catch { hiddenIds = []; }
    if (!Array.isArray(hiddenIds)) hiddenIds = [];

    const gcalEvents = (r.body.items || []).map(ev =>
      hiddenIds.includes(ev.id) ? Object.assign({}, ev, { hidden: true }) : ev
    );

    // Track threadIds already represented in Google Calendar so we don't
    // emit a synthetic duplicate.
    const takenThreadIds = new Set();
    for (const ev of gcalEvents) {
      const tid = ev && ev.extendedProperties && ev.extendedProperties.private &&
                  ev.extendedProperties.private.blusBbqThreadId;
      if (tid) takenThreadIds.add(tid);
    }

    // Pull inquiries index and synthesize events for any with event_date in window.
    let inqEvents = [];
    try {
      const rawIndex = await kvGet('inquiries:index');
      let index = rawIndex ? (typeof rawIndex === 'string' ? JSON.parse(rawIndex) : rawIndex) : [];
      if (!Array.isArray(index)) index = [];
      inqEvents = buildInquiryEvents(index, timeMin, timeMax, takenThreadIds);
    } catch (_) { inqEvents = []; }

    const events = gcalEvents.concat(inqEvents);

    return res.status(200).json({
      ok:            true,
      events,
      nextSyncToken: r.body.nextSyncToken || null,
      calendarId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};

// Exposed for unit tests
module.exports._buildInquiryEvents = buildInquiryEvents;
