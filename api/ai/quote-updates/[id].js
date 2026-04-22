/**
 * POST /api/ai/quote-updates/[id]
 * Approve or reject an AI-generated quote suggestion.
 * Approve applies the changes to the inquiry (human-confirmed only).
 * Feature-gated behind ai_quote_updates flag.
 *
 * Body: { action: 'approve'|'reject', rejectReason? }
 * Auth: SELF_MODIFY_SECRET
 *
 * Returns: { ok, id, action, item, applied? }
 */
const { getFlag } = require('../../_lib/flags.js');
const { approve, reject } = require('../../_lib/quote-update-queue.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const flagOn = await getFlag('ai_quote_updates', false);
  if (!flagOn) return res.status(404).json({ error: 'Feature not enabled' });

  const secret   = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const provided = (req.body && req.body.secret) || req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'id is required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const { action, rejectReason } = body;
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }

  try {
    if (action === 'approve') {
      const result = await approve(id);
      return res.status(200).json({ ok: true, id, action: 'approved', ...result });
    } else {
      const result = await reject(id, rejectReason || '');
      return res.status(200).json({ ok: true, id, action: 'rejected', ...result });
    }
  } catch (e) {
    const status = e.message.includes('not found') ? 404
                 : e.message.includes('not pending') ? 409 : 500;
    return res.status(status).json({ error: e.message });
  }
};
