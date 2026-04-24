/**
 * GET /api/cron/mark-completed
 * Q5 — Daily 6AM CT cron (11:00 UTC).
 * Scans all non-terminal inquiries; if event_date is today or earlier,
 * sets status = 'completed' and writes back to KV.
 *
 * Auth:
 *   - Vercel cron: Authorization: Bearer {CRON_SECRET}
 *   - Manual test: ?secret=GMAIL_READ_SECRET or X-Secret header
 *
 * Returns: { ok, scanned, completed, errors[] }
 */

module.exports.config = { maxDuration: 30 };

const https = require('https');

const INDEX_KEY = 'inquiries:index';
// Statuses that are already terminal — skip these
const TERMINAL = new Set(['completed', 'declined', 'archived']);

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + token } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.resolve();
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => { r.resume().on('end', resolve); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function secretGate(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (auth === 'Bearer ' + cronSecret) return true;
  }
  const gmailSecret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  return gmailSecret && provided === gmailSecret;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!secretGate(req)) return res.status(401).json({ error: 'Unauthorized' });

  const errors = [];
  let scanned = 0, completed = 0;

  try {
    // Load the index
    const raw = await kvGet(INDEX_KEY);
    const index = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];

    // Today's date in CT (UTC-5/UTC-6) — approximate with UTC-6 (CST)
    const now = new Date();
    const ctOffset = 6 * 60 * 60 * 1000; // 6 hours in ms (CST, conservative)
    const todayCT = new Date(now.getTime() - ctOffset);
    const todayStr = todayCT.toISOString().slice(0, 10); // YYYY-MM-DD

    for (const entry of index) {
      const { threadId, status } = entry;
      if (!threadId || TERMINAL.has(status) || status !== 'booked') continue;
      scanned++;

      // Load the full inquiry record to get event_date
      let record;
      try {
        const recRaw = await kvGet('inquiries:' + threadId);
        if (!recRaw) continue;
        record = typeof recRaw === 'string' ? JSON.parse(recRaw) : recRaw;
      } catch (e) {
        errors.push({ threadId, error: 'kvGet failed: ' + e.message });
        continue;
      }

      const ef = record.extracted_fields || {};
      const eventDate = ef.event_date; // YYYY-MM-DD or null
      if (!eventDate || eventDate >= todayStr) continue; // today or future → skip (day AFTER only)

      const completedAt = now.toISOString();
      const updatedRecord = {
        ...record,
        status: 'completed',
        completed_at: completedAt,
        updatedAt: completedAt,
        activity_log: [
          ...(record.activity_log || []),
          {
            type: 'status_change',
            summary: 'Marked completed (event date passed)',
            timestamp: completedAt,
            acknowledged: false,
            diff: [{ field: 'status', old: status, new: 'completed' }]
          }
        ]
      };

      // Update index entry — include completed_at so kanban EOM filter works without N+1 fetches
      const updatedEntry = { ...entry, status: 'completed', completed_at: completedAt, updatedAt: completedAt };
      const updatedIndex = index.map(e => e.threadId === threadId ? updatedEntry : e);

      try {
        await kvSet('inquiries:' + threadId, JSON.stringify(updatedRecord));
        await kvSet(INDEX_KEY, JSON.stringify(updatedIndex));
        completed++;
      } catch (e) {
        errors.push({ threadId, error: 'kvSet failed: ' + e.message });
      }
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }

  return res.status(200).json({ ok: true, scanned, completed, errors });
};
