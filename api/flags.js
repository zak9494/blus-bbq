/* ===== FEATURE FLAGS API
   GET  /api/flags           — list all flags (public, no auth)
   POST /api/flags/{name}    — upsert flag (requires body.secret = INQ_SECRET or SELF_MODIFY_SECRET)
   ===== */
'use strict';
const { getFlag, setFlag, listFlags } = require('./_lib/flags.js');

// Dashboard access secret — same value embedded in index.html (not a server secret).
// Accepted alongside SELF_MODIFY_SECRET so the flag-toggle UI and smoke beforeAll both work.
const INQ_SECRET = 'c857eb539774b63cf0b0a09303adc78d';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/flags — public
  if (req.method === 'GET') {
    try {
      const flags = await listFlags();
      return res.status(200).json({ ok: true, flags });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/flags/{name}
  if (req.method === 'POST') {
    const body = req.body || {};
    const serverSecret = process.env.SELF_MODIFY_SECRET;
    const isValid = body.secret === INQ_SECRET || (serverSecret && body.secret === serverSecret);
    if (!isValid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Extract flag name from path: /api/flags/some_name
    const parts = (req.url || '').split('?')[0].split('/').filter(Boolean);
    const name = parts[parts.length - 1];
    if (!name || name === 'flags') {
      return res.status(400).json({ error: 'Flag name required in path: POST /api/flags/{name}' });
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
      return res.status(400).json({ error: 'Invalid flag name — lowercase letters, digits, underscores only' });
    }
    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({ error: 'body.enabled (boolean) required' });
    }

    try {
      const rec = await setFlag(name, body.enabled, body.description || '');
      return res.status(200).json({ ok: true, name, ...rec });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
