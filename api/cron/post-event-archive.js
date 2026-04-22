/**
 * GET /api/cron/post-event-archive
 * Daily cron: finds inquiries where event_date === yesterday AND not booked/completed.
 * Moves them to 'lost', generates a "hope to serve you" draft, creates a notification.
 * Does NOT send any email.
 *
 * Auth:
 *   - Vercel cron: Authorization: Bearer {CRON_SECRET}
 *   - Manual test: ?secret=GMAIL_READ_SECRET or X-Secret header
 * Query: ?dry_run=1 to scan without writing
 *
 * Returns: { ok, yesterday, scanned, archived, errors }
 */
module.exports.config = { maxDuration: 60 };

const { runPostEventArchive } = require('../_lib/post-event-archive.js');

function secretGate(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (auth === 'Bearer ' + cronSecret) return true;
  }
  const gmailSecret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  return !!(gmailSecret && provided === gmailSecret);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!secretGate(req)) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query && (req.query.dry_run === '1' || req.query.dry_run === 'true');

  try {
    const result = await runPostEventArchive({ dryRun });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
