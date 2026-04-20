/* ===== MODULE: CALENDAR WATCH STATUS
   GET /api/calendar/watch-status
   Returns the current watch channel state from KV (no Google API call).
   Used by the dashboard sidebar to update button prominence.
   No auth required — returns only non-sensitive channel metadata.
   ===== */
'use strict';
const { kvGet, CAL_WATCH_KEY } = require('./_gcal');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const raw = await kvGet(CAL_WATCH_KEY);
    if (!raw) return res.status(200).json({ active: false });

    const watch      = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const expiration = parseInt(watch.expiration || '0', 10);
    const now        = Date.now();
    const active     = expiration > now;

    return res.status(200).json({
      active,
      expiration:     watch.expiration,
      expiresInHours: active ? Math.floor((expiration - now) / 3600000) : null,
      expiresDate:    expiration ? new Date(expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null,
      channelId:      watch.channelId || null,
      registeredAt:   watch.registeredAt || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
