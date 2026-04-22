/**
 * GET /api/pipeline/customer-history?email=...&excludeThreadId=...
 * Returns repeat-customer info for an email address.
 * Response: { status, count, bookedCount, lastEventDate, lastAmount }
 */

const { lookup } = require('../_lib/repeat-customer');

function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretGate(req, res)) return;

  const email = (req.query.email || '').trim();
  if (!email) return res.status(400).json({ error: 'email required' });

  const excludeThreadId = req.query.excludeThreadId || null;
  try {
    const data = await lookup(email, excludeThreadId);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
