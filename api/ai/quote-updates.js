/**
 * GET /api/ai/quote-updates
 * Returns pending AI-generated quote suggestions for human review.
 * Returns 404 if ai_quote_updates flag is off.
 * No auth required (suggestions contain no sensitive data; flag gates access).
 *
 * Returns: { ok, suggestions: [...] }
 */
const { getFlag } = require('../_lib/flags.js');
const { listPending, getStats } = require('../_lib/quote-update-queue.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const flagOn = await getFlag('ai_quote_updates', false);
  if (!flagOn) return res.status(404).json({ error: 'Feature not enabled' });

  try {
    const [suggestions, stats] = await Promise.all([listPending(), getStats()]);
    return res.status(200).json({ ok: true, suggestions, stats });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load suggestions', detail: e.message });
  }
};
