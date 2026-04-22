/**
 * POST /api/inquiries/draft-email
 * R4-1 Phases 7 & 8 — Ask Claude to draft a catering email.
 *
 * Body:
 *   mode: 'quote' | 'request_info'
 *   inquiry: { extracted_fields, quote, subject, from }
 *
 * Returns: { ok, subject, body }
 */

module.exports.config = { maxDuration: 30 };


const https = require('https');

const CANONICAL_SENDER = 'info@blusbarbeque.com';
const KV_TOKENS_KEY = 'gmail:' + CANONICAL_SENDER;

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
    req.on('error', reject); req.end();
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
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
                          catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function secretGate(req, res) {
  const secret   = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

async function getKVTokens() {
  let raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('Gmail not connected — visit /api/auth/init to connect info@blusbarbeque.com');
  let tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (tokens.email && tokens.email !== CANONICAL_SENDER)
    throw new Error('Sender locked to ' + CANONICAL_SENDER + '. Tokens are for ' + tokens.email + '. Re-auth required.');
  // Refresh if expired
  let { access_token: atk, expiry_date } = tokens;
  if (!atk || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!tokens.refresh_token) throw new Error('No refresh token — re-auth at /api/auth/init');
    const rr = await httpsPost('oauth2.googleapis.com', '/token',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({
        client_id:     process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type:    'refresh_token'
      }).toString()
    );
    if (rr.status >= 300 || rr.body.error)
      throw new Error('Token refresh failed: ' + JSON.stringify(rr.body).slice(0, 200));
    atk = rr.body.access_token;
    tokens = { ...tokens, access_token: atk, expiry_date: Date.now() + (rr.body.expires_in || 3600) * 1000 };
    await kvSet(KV_TOKENS_KEY, JSON.stringify(tokens));
  }
  return atk;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL             = 'claude-sonnet-4-6';

function callClaude(systemPrompt, userMsg) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY not set'));
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }]
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function fmtCurrency(n) { return '$' + (Number(n) || 0).toFixed(2); }

function buildQuoteSystemPrompt() {
  return `You are Zach, owner of Blu's Barbeque in Dallas, TX (phone: 214-514-8684).
Write a warm, professional catering quote email to a potential customer.
Tone: friendly, personal, confident. Keep it under 200 words.

Rules:
- Open with "Hi [FirstName]," (use first name only)
- Thank them for reaching out
- Do not re-include answers the customer has already received in the thread. Focus only on new or unaddressed items.
- Present the quote line items clearly (you will receive them already formatted — just include them as-is)
- Show the total prominently
- Invite them to stop by Wed–Sun after 1 PM to try samples — "just ask for Raul!"
- Close with your name, Blu's Barbeque, and 214-514-8684
- Do NOT mention any pricing changes or discounts
- Plain text only — no markdown, no bullet symbols, just line breaks`;
}

function buildRequestInfoSystemPrompt() {
  return `You are Zach, owner of Blu's Barbeque in Dallas, TX (phone: 214-514-8684).
Write a warm, friendly follow-up email asking a catering inquiry customer for missing information.
Tone: helpful, brief, not pushy. Keep it under 150 words.

Rules:
- Open with "Hi [FirstName]," (use first name only)
- Thank them for their interest
- Do not re-include answers the customer has already provided in the thread. Focus only on new or unaddressed items.
- Explain you just need a few more details to prepare their quote
- List each missing field naturally in a sentence or short list (you will receive them)
- Promise a quick turnaround once you have the info
- Close with your name, Blu's Barbeque, and 214-514-8684
- Plain text only — no markdown formatting`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const { mode, inquiry } = body;
  if (!mode || !inquiry) return res.status(400).json({ error: 'mode and inquiry are required' });

  const ef   = inquiry.extracted_fields || {};
  const q    = inquiry.quote || null;
  const name = ef.customer_name || '';
  const firstName = (name.split(' ')[0]) || 'there';

  let systemPrompt, userMsg, defaultSubject;

  if (mode === 'quote') {
    systemPrompt   = buildQuoteSystemPrompt();
    defaultSubject = "Re: Blu's BBQ — Catering Quote for " + (name || 'Your Event');

    // Format line items for Claude
    let lineItemsText = '';
    if (q && q.line_items && q.line_items.length > 0) {
      lineItemsText = q.line_items.map(li =>
        li.name + ' (' + li.qty + ' ' + li.unit + ') — ' + fmtCurrency(li.subtotal)
      ).join('\n');
    } else {
      lineItemsText = '(No line items — quote pending additional information)';
    }

    const totalText = q ? fmtCurrency(q.total) : '(pending)';
    const eventInfo = [
      ef.event_date   ? 'Event date: ' + ef.event_date : null,
      ef.guest_count  ? 'Guests: ' + ef.guest_count    : null,
      ef.event_type   ? 'Event type: ' + ef.event_type : null,
      ef.venue_name   ? 'Venue: ' + ef.venue_name      : null,
    ].filter(Boolean).join(', ');

    userMsg = `Customer first name: ${firstName}
${eventInfo ? 'Event details: ' + eventInfo : ''}

Quote line items:
${lineItemsText}

Food subtotal: ${q ? fmtCurrency(q.food_subtotal) : '—'}
Service charge: ${q ? fmtCurrency(q.service_charge) : '—'}
Delivery fee: ${q ? fmtCurrency(q.delivery_fee || 0) : '—'}
TOTAL: ${totalText}

${q && q.notes ? 'Notes: ' + q.notes : ''}

Please write the quote email now.`;

  } else if (mode === 'request_info') {
    systemPrompt   = buildRequestInfoSystemPrompt();
    defaultSubject = "Re: Blu's BBQ — Quick Follow-up on Your Catering Request";

    // Collect missing fields from quote and/or extracted_fields
    const missingFromQuote = (q && q.unresolved_preferences) ? q.unresolved_preferences : [];
    const missingFromExtract = ef.missing_fields || [];
    const allMissing = [...new Set([...missingFromExtract, ...missingFromQuote])];
    const missingText = allMissing.length > 0
      ? allMissing.map(f => '• ' + f.replace(/_/g, ' ')).join('\n')
      : '• event date\n• guest count\n• menu preferences';

    userMsg = `Customer first name: ${firstName}
${ef.event_type ? 'Event type: ' + ef.event_type : ''}

Missing information needed to prepare their quote:
${missingText}

Please write the follow-up email now.`;

  } else {
    return res.status(400).json({ error: 'mode must be "quote" or "request_info"' });
  }

  try {
    const result = await callClaude(systemPrompt, userMsg);
    if (result.error || !result.content) {
      return res.status(500).json({ error: 'Claude API error', detail: result.error || result });
    }

    let draftBody = result.content[0].text.trim();

    return res.status(200).json({
      ok: true,
      subject: defaultSubject,
      body: draftBody,
      model: result.model,
      input_tokens: result.usage && result.usage.input_tokens,
      output_tokens: result.usage && result.usage.output_tokens,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Draft generation failed', detail: e.message });
  }
};
