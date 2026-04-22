/* ===== NOTIFICATION BY ID
   GET    /api/notifications/:id — fetch single notification (public, flag-gated)
   PATCH  /api/notifications/:id — mark read or dismiss (flag-gated, no auth)
     body: { action: 'read' | 'dismiss' }
   DELETE /api/notifications/:id — delete (requires SELF_MODIFY_SECRET)
     body: { secret }
   ===== */
'use strict';
const { getFlag }            = require('../_lib/flags.js');
const { getNotification, markRead, dismissNotification, deleteNotification } = require('../_lib/notifications.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const enabled = await getFlag('notifications_center', false);
  if (!enabled) return res.status(404).json({ error: 'Not found' });

  const id = (req.query || {}).id;
  if (!id) return res.status(400).json({ error: 'id required' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const notif = await getNotification(id);
      if (!notif) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ ok: true, notification: notif });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — mark read or dismiss ──────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body   = req.body || {};
    const action = body.action;
    if (action !== 'read' && action !== 'dismiss') {
      return res.status(400).json({ error: 'action must be "read" or "dismiss"' });
    }

    try {
      const notif = action === 'read'
        ? await markRead(id)
        : await dismissNotification(id);
      if (!notif) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ ok: true, notification: notif });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
    const body     = req.body || {};
    if (!expected || body.secret !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const result = await deleteNotification(id);
      if (!result) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
