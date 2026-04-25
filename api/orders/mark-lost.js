/* POST /api/orders/mark-lost
   Marks an inquiry as Lost with a structured reason.

   Body: { id, reason, notes? }
     id     — threadId of the inquiry
     reason — one of VALID_REASONS
     notes  — optional free-text (max 500 chars)

   Auth: GMAIL_READ_SECRET via ?secret= or X-Secret header.

   Sets: status='declined', lost_at=now, lost_reason=reason, lost_reason_notes=notes.
   Updates inquiries:index entry status too.

   POST /api/orders/migrate-lost-reasons (id omitted, migrate=true):
     Back-fills lost_reason='declined' on all existing Lost orders missing a reason.
*/
'use strict';
const https = require('https');

const VALID_REASONS = [
  'declined',
  'no_response_customer',
  'no_response_us',
  'out_of_range',
  'booked_elsewhere',
  'budget_mismatch',
  'other',
];

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvExec(commands) {
  const url = kvUrl(), tok = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function isAuthorized(req) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret']
    || ((req.body || {}).secret);
  return secret && provided === secret;
}

async function markOne(threadId, reason, notes) {
  const raw = await kvGet('inquiries:' + threadId);
  if (!raw) throw new Error('Inquiry not found: ' + threadId);
  const record = typeof raw === 'string' ? JSON.parse(raw) : raw;

  const now = new Date().toISOString();
  const updated = {
    ...record,
    status: 'declined',
    lost_at: now,
    lost_reason: reason,
    lost_reason_notes: notes || null,
    updatedAt: now,
    activity_log: [
      ...(record.activity_log || []),
      {
        ts: now,
        type: 'status_change',
        summary: 'Marked Lost: ' + reason + (notes ? ' — ' + notes : ''),
        diff: [{ field: 'status', old: record.status, new: 'declined' }],
        acknowledged: false,
      },
    ],
  };

  const rawIdx = await kvGet('inquiries:index');
  let index = [];
  try { index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { index = []; }
  const updatedIndex = index.map(e =>
    e.threadId === threadId ? { ...e, status: 'declined', updatedAt: now } : e
  );

  await kvExec([
    ['SET', 'inquiries:' + threadId, JSON.stringify(updated)],
    ['SET', 'inquiries:index', JSON.stringify(updatedIndex)],
  ]);

  return { ok: true, threadId, status: 'declined', lost_reason: reason };
}

async function migrate(res) {
  const rawIdx = await kvGet('inquiries:index');
  let index = [];
  try { index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { index = []; }

  const lostEntries = index.filter(e => e.status === 'declined');
  let updated = 0;

  for (const entry of lostEntries) {
    const raw = await kvGet('inquiries:' + entry.threadId);
    if (!raw) continue;
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (record.lost_reason) continue; // already has a reason

    const now = new Date().toISOString();
    const patched = { ...record, lost_reason: 'declined', updatedAt: now };
    await kvExec([['SET', 'inquiries:' + entry.threadId, JSON.stringify(patched)]]);
    updated++;
  }

  return res.status(200).json({ ok: true, migrated: updated, total_lost: lostEntries.length });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  // Migration mode
  if (body.migrate === true) {
    return migrate(res);
  }

  const { id, reason, notes } = body;
  if (!id) return res.status(400).json({ error: 'id (threadId) required' });
  if (!reason || !VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'reason must be one of: ' + VALID_REASONS.join(', ') });
  }
  if (notes && String(notes).length > 500) {
    return res.status(400).json({ error: 'notes must be ≤ 500 characters' });
  }

  try {
    const result = await markOne(id, reason, String(notes || '').trim() || null);
    return res.status(200).json(result);
  } catch (e) {
    if (e.message.startsWith('Inquiry not found')) return res.status(404).json({ error: e.message });
    return res.status(500).json({ error: e.message });
  }
};
