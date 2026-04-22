/* ===== QUOTE UPDATE QUEUE
   KV-backed queue for AI-generated quote revision suggestions.
   Human approval is REQUIRED before any change is applied to an inquiry.

   KV keys:
     quote_updates:queue        — sorted set (score=createdAt ms, member=id)
     quote_updates:item:<id>    — JSON suggestion record

   Exports: enqueueSuggestion, listPending, approve, reject, getStats
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

const QUEUE_KEY = 'quote_updates:queue';
function itemKey(id) { return 'quote_updates:item:' + id; }
const INQ_KEY = id => 'inquiries:' + id;

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
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function parse(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

function makeId() {
  return 'qupd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// Fields that live in extracted_fields on the inquiry record
const EF_FIELDS = new Set([
  'guest_count', 'event_date', 'menu_preferences', 'dietary_restrictions',
  'budget', 'venue_name', 'venue_address', 'event_type', 'special_requests',
]);

async function enqueueSuggestion({ inquiryId, suggestion }) {
  if (!inquiryId) throw new Error('inquiryId is required');
  if (!suggestion || !Array.isArray(suggestion.changes)) throw new Error('suggestion.changes must be an array');

  const id  = makeId();
  const now = new Date().toISOString();
  const score = Date.now();
  const record = {
    id, inquiryId, suggestion,
    status: 'pending',
    createdAt: now, resolvedAt: null, rejectReason: null,
  };
  await kvExec([
    ['SET',  itemKey(id), JSON.stringify(record)],
    ['ZADD', QUEUE_KEY, score, id],
  ]);
  return record;
}

async function listPending() {
  const step1 = await kvExec([['ZREVRANGE', QUEUE_KEY, 0, 199]]);
  const ids = (step1[0] && step1[0].result) || [];
  if (!ids.length) return [];
  const step2 = await kvExec(ids.map(id => ['GET', itemKey(id)]));
  return step2
    .map(r => parse(r && r.result))
    .filter(item => item && item.status === 'pending');
}

async function approve(id) {
  const raw = await kvGet(itemKey(id));
  const item = parse(raw);
  if (!item) throw new Error('Suggestion not found: ' + id);
  if (item.status !== 'pending') throw new Error('Suggestion is not pending (status: ' + item.status + ')');

  // Load the inquiry
  const inqRaw = await kvGet(INQ_KEY(item.inquiryId));
  const inq = parse(inqRaw);
  if (!inq) throw new Error('Inquiry not found: ' + item.inquiryId);

  // Apply changes
  const ef = Object.assign({}, inq.extracted_fields || {});
  const quote = Object.assign({}, inq.quote || {});
  const applied = [];

  for (const change of item.suggestion.changes) {
    const { field, newValue } = change;
    if (EF_FIELDS.has(field)) {
      ef[field] = newValue;
      applied.push(field);
    } else if (field && field.startsWith('quote.')) {
      const qField = field.slice('quote.'.length);
      quote[qField] = newValue;
      applied.push(field);
    }
  }

  // Append activity log entry
  const actEntry = {
    id: 'act_' + Date.now(),
    timestamp: new Date().toISOString(),
    type: 'quote_update_approved',
    summary: 'AI quote suggestion approved. Changed: ' + applied.join(', '),
    diff: item.suggestion.changes.map(c => ({ field: c.field, old: c.oldValue, new: c.newValue })),
    acknowledged: false,
  };

  const updatedInq = {
    ...inq,
    extracted_fields: ef,
    quote,
    updatedAt: new Date().toISOString(),
    activity_log: [...(inq.activity_log || []), actEntry],
  };

  // Mark item approved and update inquiry
  const resolvedItem = { ...item, status: 'approved', resolvedAt: new Date().toISOString() };
  await kvExec([
    ['SET', itemKey(id), JSON.stringify(resolvedItem)],
    ['SET', INQ_KEY(item.inquiryId), JSON.stringify(updatedInq)],
  ]);

  return { ok: true, id, applied, item: resolvedItem };
}

async function reject(id, rejectReason) {
  const raw = await kvGet(itemKey(id));
  const item = parse(raw);
  if (!item) throw new Error('Suggestion not found: ' + id);
  if (item.status !== 'pending') throw new Error('Suggestion is not pending (status: ' + item.status + ')');

  const resolvedItem = {
    ...item,
    status: 'rejected',
    rejectReason: rejectReason || '',
    resolvedAt: new Date().toISOString(),
  };
  await kvExec([['SET', itemKey(id), JSON.stringify(resolvedItem)]]);
  return { ok: true, id, item: resolvedItem };
}

async function getStats() {
  const step1 = await kvExec([['ZREVRANGE', QUEUE_KEY, 0, -1]]);
  const ids = (step1[0] && step1[0].result) || [];
  if (!ids.length) return { pending: 0, approved: 0, rejected: 0, total: 0 };

  const step2 = await kvExec(ids.map(id => ['GET', itemKey(id)]));
  const items = step2.map(r => parse(r && r.result)).filter(Boolean);

  const counts = { pending: 0, approved: 0, rejected: 0 };
  items.forEach(it => { if (counts[it.status] !== undefined) counts[it.status]++; });
  return { ...counts, total: items.length };
}

module.exports = { enqueueSuggestion, listPending, approve, reject, getStats };
