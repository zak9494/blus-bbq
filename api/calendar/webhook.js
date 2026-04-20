/* ===== MODULE: CALENDAR WEBHOOK
   POST /api/calendar/webhook
   Receives Google Calendar push notifications (channel watch).
   On change: flags a pending refresh in KV and does incremental sync.
   Google also sends a sync ping when the watch channel is first created
   (X-Goog-Resource-State: sync) — respond 200 to confirm.

   Watch channel is registered via /api/calendar/watch-register (see below).
   ===== */
'use strict';
const { kvGet, kvSet, getAccessToken, gcalRequest, getOrCreateCalendarId, SYNC_TOKEN_KEY } = require('./_gcal');

const PENDING_REFRESH_KEY = 'calendar:pendingRefresh';

module.exports = async (req, res) => {
  // Google sends a sync ping when a watch channel is created
  const resourceState = req.headers['x-goog-resource-state'];
  if (resourceState === 'sync') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).end();

  // Optional: validate channel token to prevent spoofing
  const channelToken = req.headers['x-goog-channel-token'];
  const expectedToken = process.env.CALENDAR_WEBHOOK_SECRET || process.env.SELF_MODIFY_SECRET;
  if (expectedToken && channelToken && channelToken !== expectedToken) {
    return res.status(401).end();
  }

  // Flag that client should refresh on next poll
  await kvSet(PENDING_REFRESH_KEY, new Date().toISOString());

  // Do incremental sync via nextSyncToken
  try {
    const syncToken = await kvGet(SYNC_TOKEN_KEY);
    if (syncToken) {
      const token      = await getAccessToken();
      const calendarId = await getOrCreateCalendarId();
      const params     = new URLSearchParams({ syncToken });
      const calPath    = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?' + params.toString();
      const r          = await gcalRequest('GET', calPath, null, token);

      if (r.status === 200 && r.body.nextSyncToken) {
        await kvSet(SYNC_TOKEN_KEY, r.body.nextSyncToken);
      } else if (r.status === 410) {
        // Sync token expired — clear so next full fetch regenerates it
        await kvSet(SYNC_TOKEN_KEY, '');
      }
    }
  } catch (_e) {
    // Non-fatal — client will do a full refresh on next load
  }

  return res.status(200).end();
};
