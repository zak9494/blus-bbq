/* ===== MODULE: CALENDAR DELETE
   DELETE /api/calendar/delete?secret=...&eventId=...
   Body (JSON): { soft?: boolean, confirmed?: boolean }

   Past events:   soft=false → 403 (preserved for records)
                  soft=true  → marks hidden in KV, returns { ok, hidden: true }
   Future events: confirmed=false → 200 { requiresConfirmation: true }
                  confirmed=true  → deletes from Google Calendar, returns { ok }
   Unknown date:  fail open → attempts Google Calendar delete
   ===== */
'use strict';
const { getAccessToken, gcalRequest, getOrCreateCalendarId, kvGet, kvSet } = require('./_gcal');

const HIDDEN_KEY = 'calendar:hidden';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const q    = req.query || {};
  const body = req.body  || {};

  const { eventId } = q;
  if (!eventId) return res.status(400).json({ error: 'eventId query param is required' });

  try {
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();

    const getPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId);
    const evResp  = await gcalRequest('GET', getPath, null, token);

    if (evResp.status === 200 && evResp.body) {
      const startDt  = evResp.body.start && (evResp.body.start.dateTime || evResp.body.start.date);
      const evDate   = startDt ? String(startDt).slice(0, 10) : null;
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

      if (evDate && evDate < todayStr) {
        if (body.soft) {
          const raw = await kvGet(HIDDEN_KEY);
          let hidden = [];
          try { hidden = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : []; } catch { hidden = []; }
          if (!Array.isArray(hidden)) hidden = [];
          if (!hidden.includes(eventId)) hidden.push(eventId);
          await kvSet(HIDDEN_KEY, hidden);
          return res.status(200).json({ ok: true, hidden: true });
        }
        return res.status(403).json({ error: 'Cannot delete past events — use soft:true to hide them (preserved for records)' });
      }

      // Future (or today) — require explicit confirmation before deleting
      if (!body.confirmed) {
        return res.status(200).json({ requiresConfirmation: true });
      }
    }
    // If GET was non-200 (event not found), fail open and attempt deletion

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId);
    const r = await gcalRequest('DELETE', calPath, null, token);

    if (r.status !== 204 && r.status !== 200 && r.status !== 410) {
      return res.status(502).json({ error: 'Google Calendar API error', status: r.status, detail: r.body });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
