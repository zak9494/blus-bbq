/* ===== MODULE: CALENDAR LIST
   GET /api/calendar/list?secret=...&year=YYYY&month=M
   Returns Google Calendar events for the given month (or 3-month window).
   Stores nextSyncToken in KV for incremental webhook sync.
   ===== */
'use strict';
const { getAccessToken, gcalRequest, getOrCreateCalendarId, kvSet, SYNC_TOKEN_KEY } = require('./_gcal');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secret = q.secret;
  const expected = process.env.INQ_SECRET || process.env.SELF_MODIFY_SECRET;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

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

    return res.status(200).json({
      ok:            true,
      events:        r.body.items || [],
      nextSyncToken: r.body.nextSyncToken || null,
      calendarId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
