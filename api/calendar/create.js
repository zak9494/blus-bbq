/* ===== MODULE: CALENDAR CREATE
   POST /api/calendar/create
   Body: { secret, customerName, guestCount, eventDate (YYYY-MM-DD),
           eventTime (HH:MM, default 12:00), eventAddress, email, phone,
           quoteTotal, threadId, notes, durationHours (default 3) }
   Creates an event on the "Blu's Barbeque Catering" Google Calendar.
   Called by: client new-event modal, and auto-booking hook.
   ===== */
'use strict';
const { getAccessToken, gcalRequest, getOrCreateCalendarId } = require('./_gcal');

const DEFAULT_DURATION_HOURS = 3;
const TIME_ZONE = 'America/Chicago';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  const secret   = body.secret || (req.query && req.query.secret);
  const expected = process.env.INQ_SECRET || process.env.SELF_MODIFY_SECRET;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const {
    customerName, guestCount, eventDate, eventTime,
    eventAddress, email, phone, quoteTotal, threadId, notes, durationHours,
  } = body;

  if (!eventDate) return res.status(400).json({ error: 'eventDate (YYYY-MM-DD) is required' });

  try {
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();

    // Build start/end datetimes
    const time  = (eventTime || '12:00').replace(/[^0-9:]/g, '');
    const dur   = Math.max(0.5, parseFloat(durationHours) || DEFAULT_DURATION_HOURS);
    const startISO = eventDate + 'T' + time + ':00';

    // Compute end by adding duration
    const [yy, mm, dd] = eventDate.split('-').map(Number);
    const [hh, mn] = time.split(':').map(Number);
    const startMs  = new Date(yy, mm - 1, dd, hh, mn, 0).getTime();
    const endMs    = startMs + dur * 3600 * 1000;
    const endDate  = new Date(endMs);
    const pad      = n => String(n).padStart(2, '0');
    const endISO   = endDate.getFullYear() + '-' +
                     pad(endDate.getMonth() + 1) + '-' +
                     pad(endDate.getDate()) + 'T' +
                     pad(endDate.getHours()) + ':' +
                     pad(endDate.getMinutes()) + ':00';

    const appUrl   = process.env.APP_URL || 'https://blus-bbq.vercel.app';
    const descParts = [
      customerName ? 'Customer: ' + customerName : null,
      guestCount   ? 'Guests: ' + guestCount     : null,
      email        ? 'Email: ' + email            : null,
      phone        ? 'Phone: ' + phone            : null,
      quoteTotal   ? 'Quote Total: $' + parseFloat(quoteTotal).toFixed(2) : null,
      notes        ? 'Notes: ' + notes            : null,
      threadId     ? 'App Link: ' + appUrl + '/?threadId=' + encodeURIComponent(threadId) : null,
    ].filter(Boolean);

    const event = {
      summary:  (customerName || 'Catering Event') + (guestCount ? ' \u2014 ' + guestCount + ' guests' : ''),
      location: eventAddress || '',
      description: descParts.join('\n'),
      start: { dateTime: startISO, timeZone: TIME_ZONE },
      end:   { dateTime: endISO,   timeZone: TIME_ZONE },
      extendedProperties: {
        private: {
          blusBbqThreadId: threadId || '',
          blusBbqSource:   'app',
        },
      },
    };

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events';
    const r = await gcalRequest('POST', calPath, event, token);
    if (r.status !== 200 && r.status !== 201) {
      return res.status(502).json({ error: 'Google Calendar API error', status: r.status, detail: r.body });
    }

    return res.status(200).json({ ok: true, eventId: r.body.id, htmlLink: r.body.htmlLink });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
