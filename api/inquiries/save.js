/**
 * POST /api/inquiries/save
 * R4-1 Phase 4 — Create or update a catering inquiry record in KV.
 *
 * Body fields (all optional except threadId):
 *   threadId (required), messageId, raw_email, subject, from, date,
 *   extracted_fields, quote, status, history_entry: {action, actor}
 *
 * Creates record if new; deep-merges if existing.
 * Also updates inquiries:index (sorted newest-first, max 500).
 *
 * Returns: { ok, threadId, created, updated_at }
 */

module.exports.config = { maxDuration: 30 };


const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + token } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return Promise.resolve();
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function secretGate(req, res) {
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

const VALID_STATUSES = ['new','needs_info','quote_drafted','quote_approved','quote_sent','booked','declined'];

const INDEX_KEY = 'inquiries:index';
const MAX_INDEX = 500;

function recordKey(threadId) { return 'inquiries:' + threadId; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  const { threadId } = body;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'Invalid status', valid: VALID_STATUSES });
  }

  const now = new Date().toISOString();
  const key = recordKey(threadId);

  // Load existing record (or start fresh)
  let raw;
  try { raw = await kvGet(key); } catch (e) {
    return res.status(500).json({ error: 'KV read failed', detail: e.message });
  }
  const existing = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  const isNew = !existing;

  // Build merged record
  const record = {
    threadId,
    messageId:        body.messageId        ?? existing?.messageId        ?? null,
    raw_email:        body.raw_email        ?? existing?.raw_email        ?? null,
    subject:          body.subject          ?? existing?.subject          ?? null,
    from:             body.from             ?? existing?.from             ?? null,
    date:             body.date             ?? existing?.date             ?? null,
    extracted_fields: body.extracted_fields ?? existing?.extracted_fields ?? null,
    quote:            body.quote            ?? existing?.quote            ?? null,
    status:           body.status           ?? existing?.status           ?? 'new',
    created_at:       existing?.created_at  ?? now,
    updated_at:       now,
    history:          Array.isArray(existing?.history) ? [...existing.history] : [],
  };

  // Append history entry if provided
  if (body.history_entry && body.history_entry.action) {
    record.history.push({
      action:    body.history_entry.action,
      timestamp: now,
      actor:     body.history_entry.actor || 'system',
    });
  } else if (isNew) {
    record.history.push({ action: 'created', timestamp: now, actor: 'system' });
  }

  // Save record
  try { await kvSet(key, record); } catch (e) {
    return res.status(500).json({ error: 'KV write failed', detail: e.message });
  }

  // Update index
  try {
    const idxRaw = await kvGet(INDEX_KEY);
    let index = idxRaw ? (typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw) : [];
    if (!Array.isArray(index)) index = [];

    // Remove existing entry for this threadId, then prepend updated summary
    index = index.filter(e => e.threadId !== threadId);
    index = index.filter(e => e.threadId !== threadId);
    const ef = record.extracted_fields || {};
    index.push({
      threadId,
      from:          record.from || '',
      subject:       record.subject || '',
      customer_name: ef.customer_name || null,
      event_date:    ef.event_date    || null,
      guest_count:   ef.guest_count   || null,
      status:        record.status,
      email_date:    record.date || null,
      updated_at:    now,
    });
    // Sort by email received date descending (newest email first); nulls last
    index.sort((a, b) => {
      const da = a.email_date ? new Date(a.email_date).getTime() : 0;
      const db = b.email_date ? new Date(b.email_date).getTime() : 0;
      return db - da;
    });
    // Cap at MAX_INDEX
    if (index.length > MAX_INDEX) index = index.slice(0, MAX_INDEX);

    await kvSet(INDEX_KEY, index);
  } catch (e) {
    // Non-fatal — record is saved, index update failed
    return res.status(200).json({ ok: true, threadId, created: isNew, updated_at: now,
      warning: 'Record saved but index update failed: ' + e.message });
  }

  return res.status(200).json({ ok: true, threadId, created: isNew, updated_at: now });
};
