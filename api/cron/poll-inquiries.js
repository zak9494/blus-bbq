/**
 * GET /api/cron/poll-inquiries
 * R4-1 Phase 6 — Polls info@blusbarbeque.com Gmail for new catering inquiries,
 * extracts structured fields via Claude, generates AI quote, saves to KV,
 * and applies "BBQ-Processed" Gmail label to prevent reprocessing.
 *
 * Auth:
 *   - Vercel cron: Authorization: Bearer {CRON_SECRET} (system env var)
 *   - Manual test: ?secret=GMAIL_READ_SECRET or X-Secret header
 *
 * Returns: { ok, scanned, new, skipped, failed, errors[] }
 */

module.exports.config = { maxDuration: 60 };

const https = require('https');

const APP_URL    = process.env.APP_URL || 'https://blus-bbq.vercel.app';
const LABEL_NAME        = 'BBQ-Processed';
const LABEL_KV_KEY      = 'bbq:processed-label-id';
const ARCHIVED_NAME     = 'BBQ-Archived';
const ARCHIVED_KV_KEY   = 'bbq:archived-label-id';
const { detectSource }  = require('../_lib/source');

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

// ── Internal API caller ───────────────────────────────────────────────────────
function callInternal(path, method, bodyObj) {
  const secret = process.env.GMAIL_READ_SECRET;
  const url = new URL(APP_URL + path + (path.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(secret));
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Gmail API helpers (using KV tokens) ───────────────────────────────────────
const CANONICAL_SENDER = 'info@blusbarbeque.com';
const KV_TOKENS_KEY    = 'gmail:' + CANONICAL_SENDER;

async function getAccessToken() {
  const raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('Gmail not authenticated — visit /api/auth/init');
  const tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let { access_token, refresh_token, expiry_date } = tokens;

  if (!access_token || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!refresh_token) throw new Error('No refresh token — re-auth at /api/auth/init');
    const body = new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token, grant_type: 'refresh_token'
    }).toString();
    const rr = await new Promise((resolve, reject) => {
      const data = Buffer.from(body);
      const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length } }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      });
      req.on('error', reject); req.write(data); req.end();
    });
    if (!rr.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(rr));
    access_token = rr.access_token;
    await kvSet(KV_TOKENS_KEY, JSON.stringify({
      ...tokens, access_token,
      expiry_date: Date.now() + (rr.expires_in || 3600) * 1000
    }));
  }
  return access_token;
}

function gmailRequest(accessToken, method, path, bodyObj) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'gmail.googleapis.com', path, method,
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getOrCreateLabel(accessToken) {
  // Check cache first
  const cached = await kvGet(LABEL_KV_KEY);
  if (cached) return cached;

  // List labels
  const lr = await gmailRequest(accessToken, 'GET', '/gmail/v1/users/me/labels', null);
  if (lr.status >= 300) throw new Error('Labels list failed: ' + lr.status);
  const existing = (lr.body.labels || []).find(l => l.name === LABEL_NAME);
  if (existing) {
    await kvSet(LABEL_KV_KEY, existing.id);
    return existing.id;
  }
  // Create label
  const cr = await gmailRequest(accessToken, 'POST', '/gmail/v1/users/me/labels', { name: LABEL_NAME });
  if (cr.status >= 300) throw new Error('Label create failed: ' + cr.status);
  await kvSet(LABEL_KV_KEY, cr.body.id);
  return cr.body.id;
}

async function applyLabel(accessToken, threadId, labelId) {
  return gmailRequest(accessToken, 'POST',
    '/gmail/v1/users/me/threads/' + threadId + '/modify',
    { addLabelIds: [labelId] });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Auth: Vercel cron header OR GMAIL_READ_SECRET
  const cronSecret  = process.env.CRON_SECRET;
  const gmailSecret = process.env.GMAIL_READ_SECRET;
  const authHeader  = req.headers.authorization;
  const provided    = (req.query && req.query.secret) || req.headers['x-secret'];

  const cronOk   = cronSecret  && authHeader === 'Bearer ' + cronSecret;
  const manualOk = gmailSecret && provided   === gmailSecret;

  if (!cronOk && !manualOk) {
    return res.status(401).json({ error: 'Unauthorized — provide Vercel cron auth or ?secret=GMAIL_READ_SECRET' });
  }

  if (!gmailSecret) {
    return res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' });
  }

  const summary = { scanned: 0, new: 0, skipped: 0, failed: 0, errors: [] };
  const startTime = Date.now();

  // 1. List Gmail inquiries
  let listResp;
  try {
    listResp = await callInternal('/api/gmail/list-inquiries', 'GET', null);
    if (listResp.status >= 300 || !listResp.body.inquiries) {
      return res.status(502).json({ error: 'list-inquiries failed', detail: listResp.body });
    }
  } catch(e) {
    return res.status(502).json({ error: 'list-inquiries error: ' + e.message });
  }

  const inquiries = listResp.body.inquiries || [];
  summary.scanned = inquiries.length;

  // Get Gmail access token for labeling
  let accessToken, labelId, archivedLabelId;
  try {
    accessToken = await getAccessToken();
    labelId = await getOrCreateLabel(accessToken);
    // Load archived label ID from cache (may be null if no archives yet)
    const archivedIdRaw = await kvGet(ARCHIVED_KV_KEY).catch(() => null);
    archivedLabelId = typeof archivedIdRaw === 'string' ? archivedIdRaw : null;
  } catch(e) {
    // Non-fatal — we can still process without labeling
    summary.errors.push('Label setup failed: ' + e.message);
  }

  // 2. Process each inquiry
  for (const inq of inquiries) {
    // Skip if already labeled BBQ-Processed
    if (labelId && inq.labels && inq.labels.includes(labelId)) {
      summary.skipped++; continue;
    }
    // Skip if labeled BBQ-Archived (user explicitly archived this thread)
    if (archivedLabelId && inq.labels && inq.labels.includes(archivedLabelId)) {
      summary.skipped++; continue;
    }

    // Skip if already in KV
    try {
      const existing = await kvGet('inquiries:' + inq.threadId);
      if (existing) { summary.skipped++; continue; }
    } catch(e) { /* KV read failure — try to process anyway */ }

    // Guard against running too long (Vercel limit: 60s)
    if (Date.now() - startTime > 50000) {
      summary.errors.push('Time limit approaching — stopping early (' + summary.new + ' processed so far)');
      break;
    }

    try {
      // Step A: Extract fields
      const extractResp = await callInternal('/api/gmail/extract-inquiry', 'POST', {
        body: inq.body, subject: inq.subject, from: inq.from, date: inq.date
      });
      if (extractResp.status >= 300 || !extractResp.body.ok) {
        throw new Error('extract failed: ' + JSON.stringify(extractResp.body).slice(0,100));
      }
      const extracted = extractResp.body.extracted;

      // Step B: Generate quote
      let quote = null;
      const canQuote = extracted.guest_count && extracted.menu_preferences && extracted.menu_preferences.length;
      if (canQuote) {
        const serviceType = /delivery.*setup|setup.*delivery|full.service/i.test(extracted.special_requests || '')
          ? 'delivery_setup'
          : /delivery/i.test(extracted.special_requests || '') ? 'delivery' : 'pickup';

        const quoteResp = await callInternal('/api/quotes/ai-generate', 'POST', {
          ...extracted, service_type: serviceType
        });
        if (quoteResp.status < 300 && quoteResp.body.ok) {
          quote = quoteResp.body.quote;
        } else {
          summary.errors.push('Quote gen failed for ' + inq.threadId + ': ' + JSON.stringify(quoteResp.body).slice(0,80));
        }
      }

      // Step C: Determine status
      const status = canQuote ? 'quote_drafted' : 'needs_info';

      // Step D: Detect source + save to KV
      const source = detectSource(inq.from, inq.subject);
      const saveResp = await callInternal('/api/inquiries/save', 'POST', {
        threadId:      inq.threadId,
        messageId:     inq.messageId,
        subject:       inq.subject,
        from:          inq.from,
        date:          inq.date,
        raw_email:     { body: inq.body.slice(0, 5000), subject: inq.subject, from: inq.from, date: inq.date },
        extracted_fields: extracted,
        quote,
        status,
        source,
        approved: false,
        history_entry: { action: 'auto_processed_by_cron', actor: 'system' }
      });
      if (saveResp.status >= 300 || !saveResp.body.ok) {
        throw new Error('save failed: ' + JSON.stringify(saveResp.body).slice(0,100));
      }

      // Step E: Apply Gmail label
      if (accessToken && labelId) {
        try {
          await applyLabel(accessToken, inq.threadId, labelId);
        } catch(e) {
          summary.errors.push('Label apply failed for ' + inq.threadId + ': ' + e.message);
        }
      }

      summary.new++;
    } catch(e) {
      summary.failed++;
      summary.errors.push(inq.threadId + ': ' + e.message);
    }
  }

  // ── R4-2: Follow-up scan — check approved threads for new customer messages ──
  try {
    const idxRaw = await kvGet('inquiries:index');
    if (idxRaw) {
      const idx = typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw;
      const toCheck = idx
        .filter(i => i.approved === true && i.status !== 'archived' && !i.threadId.startsWith('test-'))
        .slice(0, 3); // max 3 per cron run to stay within time limit
      for (const entry of toCheck) {
        if (Date.now() - startTime > 55000) break; // guard time limit
        try {
          const fu = await callInternal('/api/inquiries/process-followup', 'POST', { threadId: entry.threadId });
          if (fu.body && fu.body.has_new_messages) {
            summary.errors.push('↩ Follow-up: ' + entry.threadId.slice(0, 12) + ' — ' + (fu.body.summary || 'new messages'));
          }
        } catch(e) { /* skip individual failures */ }
      }
    }
  } catch(e) { summary.errors.push('Follow-up scan error: ' + e.message); }

  return res.status(200).json({
    ok: true,
    ...summary,
    durationMs: Date.now() - startTime,
    processedAt: new Date().toISOString(),
  });
};
