/* ===== CRON: RENEW CALENDAR WATCH CHANNEL
   GET /api/cron/renew-calendar-watch
   Triggered daily at 5 AM CT (11 AM UTC) by Vercel cron.
   Renews the Google Calendar push-notification watch channel
   if it expires within 24 hours. No-ops otherwise.

   Security: Vercel cron runner includes x-vercel-cron:1 header.
   Manual triggers accepted with Authorization: Bearer <SELF_MODIFY_SECRET>.
   ===== */
'use strict';
const crypto = require('crypto');
const {
  kvGet, kvSet, getAccessToken, gcalRequest, getOrCreateCalendarId, CAL_WATCH_KEY
} = require('../calendar/_gcal');

const RENEW_THRESHOLD_MS = 24 * 3600 * 1000; // renew when < 24 h remain

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow Vercel's cron runner (x-vercel-cron header) or manual trigger with secret
  const isCron   = req.headers['x-vercel-cron'] === '1';
  const secret   = process.env.SELF_MODIFY_SECRET || '';
  const authHdr  = req.headers['authorization'] || '';
  const validKey = secret && authHdr === 'Bearer ' + secret;
  if (!isCron && !validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Check current watch channel
    const watchRaw = await kvGet(CAL_WATCH_KEY);
    if (watchRaw) {
      const watch = typeof watchRaw === 'string' ? JSON.parse(watchRaw) : watchRaw;
      const expiration = parseInt(watch.expiration || '0', 10);
      const timeLeft   = expiration - Date.now();
      if (timeLeft > RENEW_THRESHOLD_MS) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          message: 'Watch channel valid — ' + Math.floor(timeLeft / 3600000) + 'h remaining',
          expiration: watch.expiration,
        });
      }
    }

    // Renew the watch channel
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();
    const appUrl     = process.env.APP_URL || 'https://blus-bbq.vercel.app';
    const channelId  = 'blus-bbq-cal-' + crypto.randomBytes(8).toString('hex');
    const chanToken  = process.env.CALENDAR_WEBHOOK_SECRET || process.env.SELF_MODIFY_SECRET || '';

    const watchBody = {
      id:         channelId,
      type:       'web_hook',
      address:    appUrl + '/api/calendar/webhook',
      token:      chanToken,
      expiration: String(Date.now() + 7 * 24 * 3600 * 1000),
    };

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/watch';
    const r = await gcalRequest('POST', calPath, watchBody, token);

    if (r.status !== 200 && r.status !== 201) {
      return res.status(502).json({
        error:  'Watch renewal failed',
        status: r.status,
        detail: r.body,
      });
    }

    await kvSet(CAL_WATCH_KEY, JSON.stringify({
      channelId,
      resourceId:   r.body.resourceId,
      expiration:   r.body.expiration,
      webhookUrl:   appUrl + '/api/calendar/webhook',
      registeredAt: new Date().toISOString(),
    }));

    return res.status(200).json({
      ok:         true,
      renewed:    true,
      channelId,
      expiration: r.body.expiration,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
