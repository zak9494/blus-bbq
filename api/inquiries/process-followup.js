/**
 * POST /api/inquiries/process-followup
 * R4-2 — Checks a Gmail thread for new customer messages since last processing.
 * Extracts field updates, merges, optionally re-generates quote.
 * Sets has_unreviewed_update: true if new content found.
 */
module.exports.config = { maxDuration: 30 };
const https = require('https');
const { maybeTriggerDessertOffer } = require('../_lib/dessert-trigger.js');

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

function callInternal(path, method, bodyObj) {
  const secret = process.env.GMAIL_READ_SECRET;
  const appUrl = process.env.APP_URL || 'https://blus-bbq.vercel.app';
  const sep = path.includes('?') ? '&' : '?';
  const url = new URL(appUrl + path + sep + 'secret=' + encodeURIComponent(secret));
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: method || 'GET',
      headers: { 'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) } };
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

function gmailRequest(token, method, path, bodyObj) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'gmail.googleapis.com', path, method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) } };
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

async function getAccessToken() {
  const raw = await kvGet('gmail:info@blusbarbeque.com');
  if (!raw) throw new Error('No Gmail token — visit /api/auth/init');
  const tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let { access_token, refresh_token, expiry_date } = tokens;
  if (access_token && (!expiry_date || expiry_date > Date.now() + 60000)) return access_token;
  if (!refresh_token) throw new Error('No refresh token');
  const body = Buffer.from(new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token, grant_type: 'refresh_token'
  }).toString());
  const rr = await new Promise((res, rej) => {
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
  if (!rr.access_token) throw new Error('Token refresh failed');
  await kvSet('gmail:info@blusbarbeque.com', JSON.stringify({
    ...tokens, access_token: rr.access_token,
    expiry_date: Date.now() + (rr.expires_in || 3600) * 1000
  }));
  return rr.access_token;
}

function getBodyText(payload) {
  if (!payload) return '';
  const parts = payload.parts || [payload];
  let text = '';
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      text += Buffer.from(part.body.data, 'base64').toString('utf-8') + '\n';
    } else if (part.parts) {
      text += getBodyText(part);
    }
  }
  return text.slice(0, 3000);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = req.headers['x-secret'] || (req.query && req.query.secret);
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId } = req.body || {};
  if (!threadId) return res.status(400).json({ error: 'threadId required' });

  // Load existing inquiry
  const recRaw = await kvGet('inquiries:' + threadId);
  if (!recRaw) return res.status(404).json({ error: 'Inquiry not found: ' + threadId });
  const rec = typeof recRaw === 'string' ? JSON.parse(recRaw) : recRaw;
  if (rec.status === 'archived') return res.status(200).json({ ok: true, skipped: 'archived' });

  // Get Gmail access token
  let accessToken;
  try { accessToken = await getAccessToken(); }
  catch(e) { return res.status(500).json({ error: 'Token error: ' + e.message }); }

  // Fetch thread from Gmail
  const threadResp = await gmailRequest(accessToken, 'GET',
    '/gmail/v1/users/me/threads/' + threadId + '?format=full', null);
  if (threadResp.status !== 200 || !threadResp.body) {
    return res.status(200).json({ ok: false, error: 'Gmail fetch failed', status: threadResp.status });
  }

  const messages = threadResp.body.messages || [];
  const currentCount = messages.length;
  const lastCount = rec.message_count_at_last_process || 1;

  if (currentCount <= lastCount) {
    return res.status(200).json({ ok: true, has_new_messages: false, message_count: currentCount });
  }

  // Identify new messages — skip those from blusbarbeque.com (our own replies)
  const newMessages = messages.slice(lastCount).filter(m => {
    const from = ((m.payload && m.payload.headers) || []).find(h => h.name === 'From');
    return !from || !from.value.toLowerCase().includes('blusbarbeque.com');
  });

  if (!newMessages.length) {
    // Only our own replies — update count but don't flag as unreviewed
    await callInternal('/api/inquiries/save', 'POST', {
      threadId,
      message_count_at_last_process: currentCount,
      last_processed_message_id: messages[messages.length - 1].id,
    });
    return res.status(200).json({ ok: true, has_new_messages: false, only_own_replies: true });
  }

  // Extract text from new customer messages
  const newTexts = newMessages.map(m => {
    const fromHdr = ((m.payload && m.payload.headers) || []).find(h => h.name === 'From');
    const from = fromHdr ? fromHdr.value : '';
    const body = getBodyText(m.payload);
    return 'From: ' + from + '\n' + body;
  }).join('\n---\n');

  // Call extract endpoint
  let diff = [];
  let newFields = {};
  let quoteRegenNeeded = false;
  try {
    const extractResp = await callInternal('/api/gmail/extract-inquiry', 'POST', {
      body: newTexts, subject: rec.subject || '', from: rec.from || '',
      date: new Date().toISOString(), is_followup: true,
    });
    if (extractResp.body && extractResp.body.ok && extractResp.body.extracted) {
      newFields = extractResp.body.extracted;
      const existing = rec.extracted_fields || {};
      const trackFields = ['guest_count','event_date','customer_name','venue_name','venue_address',
        'event_type','dietary_restrictions','menu_preferences','budget'];
      for (const f of trackFields) {
        const nv = newFields[f];
        const ov = existing[f];
        if (nv && nv !== ov) {
          diff.push({ field: f, old: ov || null, new: nv });
          if (f === 'guest_count' || f === 'event_date') quoteRegenNeeded = true;
        }
      }
    }
  } catch(e) { /* extraction failure is non-fatal */ }

  // Build activity log entry
  const actEntry = {
    id: 'act_' + Date.now(),
    timestamp: new Date().toISOString(),
    type: 'followup',
    message_count: currentCount,
    new_messages: newMessages.length,
    diff,
    quote_regenerated: false,
    acknowledged: false,
    summary: diff.length > 0
      ? 'Customer updated: ' + diff.map(d => d.field.replace(/_/g, ' ')).join(', ')
      : 'Customer sent ' + newMessages.length + ' new message(s)',
  };

  // Merge new fields (non-null new values override existing)
  const mergedFields = Object.assign({}, rec.extracted_fields || {},
    Object.fromEntries(Object.entries(newFields).filter(([k, v]) => v != null && v !== '')));

  // Flip quote status back if approved/sent and fields changed
  let newStatus = rec.status;
  if (diff.length > 0 && (rec.status === 'quote_approved' || rec.status === 'quote_sent')) {
    newStatus = 'quote_drafted';
  }

  // Re-generate quote if guest_count or event_date changed
  let newQuote = rec.quote;
  if (quoteRegenNeeded && mergedFields.guest_count) {
    try {
      const qResp = await callInternal('/api/quotes/ai-generate', 'POST',
        { ...mergedFields, force: true });
      if (qResp.body && qResp.body.ok && qResp.body.quote) {
        newQuote = qResp.body.quote;
        actEntry.quote_regenerated = true;
      }
    } catch(e) { /* quote regen failure is non-fatal */ }
  }

  // Append to activity log
  const actLog = [...(rec.activity_log || []), actEntry];

  // Save updated record
  const saveBody = {
    threadId,
    extracted_fields: mergedFields,
    status: newStatus,
    has_unreviewed_update: true,
    activity_log: actLog,
    last_processed_message_id: messages[messages.length - 1].id,
    message_count_at_last_process: currentCount,
    history_entry: { action: 'followup_detected', actor: 'system' },
  };
  if (newQuote !== rec.quote) saveBody.quote = newQuote;

  await callInternal('/api/inquiries/save', 'POST', saveBody);

  // Dessert add-on prompt: if customer replied to a quote_sent inquiry, notify Zach
  const updatedInquiry = { ...rec, status: newStatus, extracted_fields: mergedFields };
  maybeTriggerDessertOffer(updatedInquiry).catch(() => {});

  return res.status(200).json({
    ok: true, has_new_messages: true, new_messages: newMessages.length,
    diff, quote_regenerated: actEntry.quote_regenerated,
    status: newStatus, summary: actEntry.summary,
  });
};
