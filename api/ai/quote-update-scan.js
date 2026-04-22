/**
 * POST /api/ai/quote-update-scan
 * Reads an inbound email on a thread, uses Claude to extract proposed quote changes,
 * enqueues the suggestion for Zach's review, and returns the suggestion.
 * Feature-gated behind ai_quote_updates flag.
 * NEVER auto-applies changes — always human-in-the-loop.
 *
 * Body: { inquiryId, inboundEmailId? }
 * Auth: GMAIL_READ_SECRET
 *
 * Returns: { ok, suggestion: { changes, summary }, suggestionId }
 */
module.exports.config = { maxDuration: 30 };

const https = require('https');
const { getFlag } = require('../_lib/flags.js');
const { enqueueSuggestion } = require('../_lib/quote-update-queue.js');

const MODEL = 'claude-sonnet-4-6';
const CANONICAL_SENDER = 'info@blusbarbeque.com';

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

function parse(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

function secretGate(req, res) {
  const secret   = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function getAccessToken() {
  const raw = await kvGet('gmail:' + CANONICAL_SENDER);
  if (!raw) throw new Error('Gmail not connected');
  const tokens = parse(raw);
  let { access_token, refresh_token, expiry_date } = tokens;
  if (access_token && (!expiry_date || expiry_date > Date.now() + 60000)) return access_token;
  if (!refresh_token) throw new Error('No refresh token');
  const params = Buffer.from(new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token, grant_type: 'refresh_token',
  }).toString());
  const rr = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': params.length } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject); req.write(params); req.end();
  });
  if (!rr.access_token) throw new Error('Token refresh failed');
  await (new Promise((resolve, reject) => {
    const body = JSON.stringify([['SET', 'gmail:' + CANONICAL_SENDER,
      JSON.stringify({ ...tokens, access_token: rr.access_token,
        expiry_date: Date.now() + (rr.expires_in || 3600) * 1000 })]]);
    const u = new URL((kvUrl()) + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + kvToken(), 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => { r.resume().on('end', resolve); });
    req.on('error', reject); req.write(body); req.end();
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

async function fetchEmailBody(accessToken, messageId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/messages/' + messageId + '?format=full',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

async function extractChangesViaClaude(inquiry, emailBody) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const ef  = inquiry.extracted_fields || {};
  const q   = inquiry.quote || {};
  const current = {
    guest_count:          ef.guest_count || null,
    event_date:           ef.event_date  || null,
    menu_preferences:     ef.menu_preferences  || [],
    dietary_restrictions: ef.dietary_restrictions || [],
    budget:               ef.budget || null,
    quote_total:          q.total  || null,
  };

  const systemPrompt = `You are an AI assistant helping a BBQ catering business review customer messages.
Your job is to identify if the customer is requesting changes to their catering quote.
Extract ONLY explicit, clearly stated change requests. Do not infer or guess.

Return a JSON object with this exact shape:
{
  "changes": [
    {
      "field": "<field name>",
      "oldValue": "<current value or null>",
      "newValue": "<requested new value>",
      "confidence": 0.0-1.0,
      "reason": "<one sentence explaining why this is a change request>"
    }
  ],
  "summary": "<one sentence summary of what the customer wants changed, or 'No clear change requests' if none>"
}

Valid field names: guest_count, event_date, menu_preferences, dietary_restrictions, budget, quote.discount
Return an empty changes array if no changes are requested.
Return only valid JSON — no markdown, no code fences.`;

  const userMsg = `Current quote details:
${JSON.stringify(current, null, 2)}

Customer's new message:
${emailBody}

Extract any proposed changes now.`;

  const body = JSON.stringify({
    model: MODEL, max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });

  if (result.error || !result.content) throw new Error('Claude error: ' + JSON.stringify(result).slice(0, 200));
  const text = result.content[0].text.trim();
  try { return JSON.parse(text); }
  catch { throw new Error('Claude returned non-JSON: ' + text.slice(0, 200)); }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const flagOn = await getFlag('ai_quote_updates', false);
  if (!flagOn) return res.status(404).json({ error: 'Feature not enabled' });

  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const { inquiryId, inboundEmailId } = body;
  if (!inquiryId) return res.status(400).json({ error: 'inquiryId is required' });

  let inquiry;
  try {
    const raw = await kvGet('inquiries:' + inquiryId);
    if (!raw) return res.status(404).json({ error: 'Inquiry not found: ' + inquiryId });
    inquiry = parse(raw);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load inquiry: ' + e.message });
  }

  let emailBody = '';
  if (inboundEmailId) {
    try {
      const accessToken = await getAccessToken();
      const msg = await fetchEmailBody(accessToken, inboundEmailId);
      if (msg && msg.payload) emailBody = getBodyText(msg.payload);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to fetch email: ' + e.message });
    }
  }

  if (!emailBody.trim()) {
    return res.status(400).json({ error: 'No email body to analyze. Provide inboundEmailId or non-empty email content.' });
  }

  let suggestion;
  try {
    suggestion = await extractChangesViaClaude(inquiry, emailBody);
  } catch (e) {
    return res.status(500).json({ error: 'Claude extraction failed', detail: e.message });
  }

  // Enqueue for human review — NEVER auto-apply
  let queued;
  try {
    queued = await enqueueSuggestion({ inquiryId, suggestion });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to enqueue suggestion', detail: e.message });
  }

  return res.status(200).json({ ok: true, suggestion, suggestionId: queued.id });
};
