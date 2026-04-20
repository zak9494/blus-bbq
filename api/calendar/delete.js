/* ===== MODULE: CALENDAR DELETE
   DELETE /api/calendar/delete?secret=...&eventId=...
   Removes an event from the "Blu's Barbeque Catering" calendar.
   ===== */
'use strict';
const { getAccessToken, gcalRequest, getOrCreateCalendarId } = require('./_gcal');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: getAccessToken() below proves authorization via OAuth token in KV.
  const q = req.query || {};

  const { eventId } = q;
  if (!eventId) return res.status(400).json({ error: 'eventId query param is required' });

  try {
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId);
    const r = await gcalRequest('DELETE', calPath, null, token);

    // 204 No Content = success; 410 Gone = already deleted (treat as OK)
    if (r.status !== 204 && r.status !== 200 && r.status !== 410) {
      return res.status(502).json({ error: 'Google Calendar API error', status: r.status, detail: r.body });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
