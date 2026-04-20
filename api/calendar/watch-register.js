/* ===== MODULE: CALENDAR WATCH REGISTER
   POST /api/calendar/watch-register?secret=...
   Registers a Google Calendar push-notification watch channel.
   Google will POST to /api/calendar/webhook when any event changes.

   Requirements:
   - The domain must be verified in Google Cloud Console (Vercel domains are).
   - Watch channels expire after max 7 days; re-register via cron or manually.
   - Channel ID and expiry stored in KV under calendar:watch for tracking.

   Must be called once after deploying. A button in Modify Dashboard triggers this.
   ===== */
'use strict';
const crypto = require('crypto');
const { getAccessToken, gcalRequest, getOrCreateCalendarId, kvGet, kvSet, CAL_WATCH_KEY } = require('./_gcal');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Accept secret from query string OR request body (belt-and-suspenders for
  // cases where Vercel rewrites strip query params on POST requests).
  const q      = req.query || {};
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const secret   = q.secret || body.secret || '';
  const expected = process.env.INQ_SECRET || process.env.SELF_MODIFY_SECRET;

  if (!expected) {
    // Env vars not set — return 500 with clear message instead of a misleading 401
    return res.status(500).json({
      error: 'Server misconfiguration: INQ_SECRET and SELF_MODIFY_SECRET env vars are not set on this deployment.',
      fix:   'Set INQ_SECRET in Vercel project settings → Environment Variables.',
    });
  }
  if (!secret || secret !== expected) {
    return res.status(401).json({
      error: 'Unauthorized',
      detail: !secret
        ? 'No secret provided. Send ?secret=INQ_SECRET as a query param or in the POST body.'
        : 'Secret mismatch. Check that the INQ_SECRET env var in Vercel matches the hardcoded value in index.html.',
    });
  }

  try {
    const token      = await getAccessToken();
    const calendarId = await getOrCreateCalendarId();

    const appUrl       = process.env.APP_URL || 'https://blus-bbq.vercel.app';
    const webhookUrl   = appUrl + '/api/calendar/webhook';
    const channelId    = 'blus-bbq-cal-' + crypto.randomBytes(8).toString('hex');
    const channelToken = process.env.CALENDAR_WEBHOOK_SECRET || process.env.SELF_MODIFY_SECRET || '';

    const watchBody = {
      id:      channelId,
      type:    'web_hook',
      address: webhookUrl,
      token:   channelToken,
      // TTL: 7 days in ms (Google max is also ~7 days for calendar.events)
      expiration: String(Date.now() + 7 * 24 * 3600 * 1000),
    };

    const calPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/watch';
    const r = await gcalRequest('POST', calPath, watchBody, token);

    if (r.status !== 200 && r.status !== 201) {
      return res.status(502).json({
        error: 'Google Calendar watch registration failed',
        status: r.status,
        detail: r.body,
        hint: r.status === 400
          ? 'Make sure the webhook URL is publicly reachable and the domain is verified in Google Cloud Console.'
          : undefined,
      });
    }

    // Store channel info in KV for tracking/renewal
    await kvSet(CAL_WATCH_KEY, JSON.stringify({
      channelId,
      resourceId:  r.body.resourceId,
      expiration:  r.body.expiration,
      webhookUrl,
      registeredAt: new Date().toISOString(),
    }));

    return res.status(200).json({
      ok: true,
      channelId,
      resourceId:  r.body.resourceId,
      expiration:  r.body.expiration,
      webhookUrl,
      note: 'Watch channel active for ~7 days. Re-register before expiry to maintain real-time sync.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
