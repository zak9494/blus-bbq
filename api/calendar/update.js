/* ===== MODULE: CALENDAR UPDATE
   PATCH /api/calendar/update
   Body: { secret, eventId, ...patchFields }
   Patches an existing event on the "Blu's Barbeque Catering" calendar.
   Supports any valid Google Calendar event fields as patch body.
   ===== */
'use strict';
const { getAccessToken, gcalRequest, getOrCreateCalendarId } = require('./_gcal');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  // Auth: getAccessToken() below proves authorization via OAuth token in KV.

  const { eventId, secret: _s, ...patch } = body; // strip secret from patch payload
  if (!eventId) return res.status(400).json({ error: 'eventId is required' });

  try {
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId);
    const r = await gcalRequest('PATCH', calPath, patch, token);
    if (r.status !== 200) {
      return res.status(502).json({ error: 'Google Calendar API error', status: r.status, detail: r.body });
    }

    return res.status(200).json({ ok: true, event: r.body });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
