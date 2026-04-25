'use strict';
const { getFlag }            = require('../_lib/flags.js');
const { createNotification, listNotifications } = require('../_lib/notifications.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const enabled = await getFlag('notifications_center', false);

  if (req.method === 'GET') {
    if (!enabled) {
      return res.status(200).json({ ok: true, notifications: [], total: 0, unread_count: 0 });
    }
    const q           = req.query || {};
    const limit       = Math.min(parseInt(q.limit,  10) || 50, 200);
    const offset      = Math.max(parseInt(q.offset, 10) || 0,   0);
    const unread_only = q.unread_only === 'true' || q.unread_only === '1';
    const type        = q.type || null;

    try {
      const result = await listNotifications({ limit, offset, unread_only, type });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    if (!enabled) return res.status(404).json({ error: 'Not found' });
    const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
    const body     = req.body || {};
    if (!expected || body.secret !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type, title, body: notifBody, metadata, customerId, inquiryId,
            severity, sound, icon } = body;
    if (!type || !title) {
      return res.status(400).json({ error: 'type and title are required' });
    }

    try {
      const notif = await createNotification({
        type, title, body: notifBody || '', metadata, customerId, inquiryId,
        severity, sound, icon,
      });
      return res.status(201).json({ ok: true, notification: notif });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
