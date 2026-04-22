/**
 * GET  /api/settings/guest-count-lockin  → { ok, days }
 * POST /api/settings/guest-count-lockin  → { ok, days }
 *   Body: { days: number }
 *   Auth: SELF_MODIFY_SECRET
 *
 * Controls how many days before a booked event to prompt for final guest count.
 * Default 0 = disabled.
 */

const { getLockinDays, setLockinDays } = require('../_lib/guest-count-lockin.js');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const days = await getLockinDays();
      return res.status(200).json({ ok: true, days });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    const secret   = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
    const provided = (req.body && req.body.secret) || req.headers['x-secret'];
    if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
    body = body || {};

    const { days } = body;
    if (days === undefined || days === null) return res.status(400).json({ error: 'days is required' });

    try {
      const saved = await setLockinDays(days);
      return res.status(200).json({ ok: true, days: saved });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
};
