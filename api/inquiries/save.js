/**
 * POST /api/inquiries/save
 * Merged: R4-1/R4-2 Gmail pipeline path + C20 Quote Builder path.
 *
 * Auth (either is sufficient):
 *   - ?secret=GMAIL_READ_SECRET or X-Secret header  (cron / approve / archive / pipeline callers)
 *   - body.secret === SELF_MODIFY_SECRET             (Quote Builder direct save)
 *
 * Route A — threadId present in body: create-or-deep-merge Gmail/pipeline inquiry.
 *   Required: threadId
 *   Returns: { ok, threadId, created, updated_at }
 *
 * Route B — no threadId, customer_name present: Quote Builder new inquiry.
 *   Required: customer_name
 *   Generates a qb-prefixed threadId.
 *   Returns: { ok, threadId }
 *
 * KV keys written:
 *   inquiries:index        (sorted newest-first, max 500)
 *   inquiries:{threadId}   (full record)
 */

module.exports.config = { maxDuration: 30 };

'use strict';
const https  = require('https');
const crypto = require('crypto');

// ── KV helpers ────────────────────────────────────────────────────────────────
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
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 300) {
          reject(new Error('KV pipeline returned HTTP ' + r.statusCode + ': ' + d.slice(0, 200)));
        } else {
          resolve();
        }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function isAuthorized(req) {
  // Method 1: URL/header secret (pipeline callers — cron, approve, archive, etc.)
  const gmailSecret = process.env.GMAIL_READ_SECRET;
  const urlProvided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (gmailSecret && urlProvided === gmailSecret) return true;

  // Method 2: body.secret (Quote Builder C20 path)
  const selfSecret = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const bodySecret = (req.body || {}).secret;
  if (selfSecret && bodySecret === selfSecret) return true;

  return false;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_STATUSES = ['new','needs_info','quote_drafted','quote_approved','quote_sent','booked','declined','archived'];
const INDEX_KEY = 'inquiries:index';
const MAX_INDEX = 500;

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  // ── Route A: threadId present — pipeline / Gmail / approve / archive ─────
  if (body.threadId) {
    return handlePipelineSave(req, res, body);
  }

  // ── Route B: Quote Builder — no threadId, needs customer_name ───────────
  if (body.customer_name) {
    return handleQuoteBuilderSave(req, res, body);
  }

  return res.status(400).json({ error: 'threadId or customer_name is required' });
};

// ── Route A: pipeline save (R4-2 deep-merge) ─────────────────────────────────
async function handlePipelineSave(req, res, body) {
  const { threadId } = body;

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: 'Invalid status', valid: VALID_STATUSES });
  }

  const now = new Date().toISOString();
  const key = 'inquiries:' + threadId;

  let raw;
  try { raw = await kvGet(key); } catch (e) {
    return res.status(500).json({ error: 'KV read failed', detail: e.message });
  }
  const existing = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  const isNew = !existing;

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
    source:           body.source           ?? existing?.source           ?? 'direct',
    approved:         body.approved         ?? existing?.approved         ?? false,
    has_unreviewed_update:         body.has_unreviewed_update         ?? existing?.has_unreviewed_update         ?? false,
    activity_log:                  body.activity_log                  ?? existing?.activity_log                  ?? [],
    last_processed_message_id:     body.last_processed_message_id     ?? existing?.last_processed_message_id     ?? null,
    message_count_at_last_process: body.message_count_at_last_process ?? existing?.message_count_at_last_process ?? 1,
    quote_total:      body.quote_total      ?? existing?.quote_total      ?? null,
    created_at:       existing?.created_at  ?? now,
    updated_at:       now,
    history:          Array.isArray(existing?.history) ? [...existing.history] : [],
  };

  if (body.history_entry && body.history_entry.action) {
    record.history.push({ action: body.history_entry.action, timestamp: now,
      actor: body.history_entry.actor || 'system' });
  } else if (isNew) {
    record.history.push({ action: 'created', timestamp: now, actor: 'system' });
  }

  try { await kvSet(key, record); } catch (e) {
    return res.status(500).json({ error: 'KV write failed', detail: e.message });
  }

  try {
    const idxRaw = await kvGet(INDEX_KEY);
    let index = idxRaw ? (typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw) : [];
    if (!Array.isArray(index)) index = [];
    index = index.filter(e => e.threadId !== threadId);
    const ef = record.extracted_fields || {};
    index.push({
      threadId,
      from:          record.from || '',
      subject:       record.subject || '',
      customer_name: ef.customer_name || body.customer_name || null,
      event_date:    ef.event_date    || null,
      guest_count:   ef.guest_count   || null,
      status:        record.status,
      source:        record.source   || 'direct',
      approved:      record.approved || false,
      has_unreviewed_update: record.has_unreviewed_update || false,
      email_date:    record.date || null,
      quote_total:   record.quote_total || null,
      updated_at:    now,
    });
    index.sort((a, b) => {
      const da = a.email_date ? new Date(a.email_date).getTime() : 0;
      const db = b.email_date ? new Date(b.email_date).getTime() : 0;
      return db - da;
    });
    if (index.length > MAX_INDEX) index = index.slice(0, MAX_INDEX);
    await kvSet(INDEX_KEY, index);
  } catch (e) {
    return res.status(200).json({ ok: true, threadId, created: isNew, updated_at: now,
      warning: 'Record saved but index update failed: ' + e.message });
  }

  return res.status(200).json({ ok: true, threadId, created: isNew, updated_at: now });
}

// ── Route B: Quote Builder save (C20) ────────────────────────────────────────
async function handleQuoteBuilderSave(req, res, body) {
  const {
    customer_name, email, event_date, event_time, guest_count,
    service_type, delivery_address, quote,
  } = body;
  const special_requests = (body.special_requests || body.notes || '').trim();

  const now      = new Date().toISOString();
  const rand     = crypto.randomBytes(4).toString('hex');
  const threadId = 'qb-' + Date.now() + '-' + rand;
  const fromAddr = email ? customer_name + ' <' + email + '>' : customer_name;
  const subject  = 'Quote for ' + customer_name + (event_date ? ' (' + event_date + ')' : '');
  const bodyText = [
    'Created manually from Quote Builder.',
    guest_count      ? 'Guests: '  + guest_count      : '',
    service_type     ? 'Service: ' + service_type     : '',
    delivery_address ? 'Address: ' + delivery_address : '',
    special_requests ? 'Special Requests: ' + special_requests : '',
  ].filter(Boolean).join('\n');

  const indexEntry = {
    threadId,
    customer_name,
    from:      fromAddr,
    email:     email || '',
    source:    'direct',
    status:    quote && quote.line_items && quote.line_items.length ? 'quote_drafted' : 'new',
    event_date: event_date || '',
    guest_count: guest_count || null,
    subject,
    storedAt:  now,
    approved:  false,
    has_unreviewed_update: false,
    quote_total: quote && quote.grand_total ? quote.grand_total : null,
    email_date: now,
    updated_at: now,
  };

  const fullInquiry = {
    ...indexEntry,
    body:       bodyText,
    event_time: event_time || '',
    delivery_address: delivery_address || '',
    special_requests: special_requests || '',
    extracted_fields: {
      customer_name,
      customer_email: email || '',
      event_date:    event_date || '',
      event_time:    event_time || '',
      guest_count:   guest_count || null,
      service_type:  service_type || 'pickup',
      delivery_address: delivery_address || '',
      special_requests: special_requests || '',
    },
    quote: quote || null,
    activity_log: [],
    history: [{ action: 'created_via_quote_builder', timestamp: now, actor: 'user' }],
    created_at: now,
    updated_at: now,
  };

  try {
    const idxRaw = await kvGet(INDEX_KEY);
    const index  = idxRaw ? (typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw) : [];
    index.unshift(indexEntry);

    await kvSet('inquiries:' + threadId, fullInquiry);
    await kvSet(INDEX_KEY, index);

    return res.status(200).json({ ok: true, threadId });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
