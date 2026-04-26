'use strict';
const { getFlag } = require('../_lib/flags.js');
const { listNotifications } = require('../_lib/notifications.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const enabled = await getFlag('notifications_center');
  if (!enabled) return res.status(200).json({ ok: true, unread_count: 0, by_type: {} });

  try {
    const { notifications, unread_count } = await listNotifications({ limit: 200, offset: 0 });
    const by_type = {};
    notifications.forEach(n => {
      if (!n.read) by_type[n.type] = (by_type[n.type] || 0) + 1;
    });
    return res.status(200).json({ ok: true, unread_count, by_type });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
