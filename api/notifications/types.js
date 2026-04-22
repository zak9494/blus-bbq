/* ===== NOTIFICATION TYPES
   GET  /api/notifications/types — list all types with current text (public, flag-gated)
   POST /api/notifications/types — update type text (requires SELF_MODIFY_SECRET)
     body: { secret, id, defaultText?, defaultSound?, defaultIcon? }
   ===== */
'use strict';
const { getFlag }                  = require('../_lib/flags.js');
const { listTypes, upsertType, SEED_TYPES } = require('../_lib/notification-types.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const enabled = await getFlag('notifications_center', false);
  if (!enabled) return res.status(404).json({ error: 'Not found' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const types = await listTypes();
      return res.status(200).json({ ok: true, types });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
    const body     = req.body || {};
    if (!expected || body.secret !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id, defaultText, defaultSound, defaultIcon } = body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const knownIds = SEED_TYPES.map(t => t.id);
    if (!knownIds.includes(id)) {
      return res.status(400).json({ error: 'Unknown type id: ' + id });
    }

    const fields = {};
    if (defaultText  !== undefined) fields.defaultText  = defaultText;
    if (defaultSound !== undefined) fields.defaultSound = defaultSound;
    if (defaultIcon  !== undefined) fields.defaultIcon  = defaultIcon;

    try {
      const record = await upsertType(id, fields);
      return res.status(200).json({ ok: true, type: record });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
