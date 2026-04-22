/* ===== MARK ALL NOTIFICATIONS READ
   POST /api/notifications/mark-all-read  (flag-gated, no admin auth needed)
   ===== */
'use strict';
const { getFlag }    = require('../_lib/flags.js');
const { markAllRead } = require('../_lib/notifications.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const enabled = await getFlag('notifications_center', false);
  if (!enabled) return res.status(404).json({ error: 'Not found' });

  try {
    const result = await markAllRead();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
