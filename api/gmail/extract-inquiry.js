/**
 * POST /api/gmail/extract-inquiry
 * R4-1 Phase 2 — Extracts structured catering inquiry data from a raw email.
 *
 * Input (JSON body):
 *   { body: string, subject: string, from: string, date: string }
 *
 * Output:
 *   { customer_name, customer_email, customer_phone, event_date (ISO8601),
 *     event_time, event_type, guest_count (number), venue_name, venue_address,
 *     menu_preferences (string[]), dietary_restrictions (string[]),
 *     budget (number), special_requests, missing_fields (string[]) }
 *
 * Secret gate: ?secret=GMAIL_READ_SECRET or X-Secret header.
 * Model: claude-sonnet-4-6 (non-streaming, native https.request).
 */

module.exports.config = { maxDuration: 60 };

const https = require('https');

const SYSTEM_PROMPT = `You are a catering inquiry parser for Blu's Barbeque, a BBQ catering company in Dallas, TX.

Your job: extract structured data from catering inquiry emails sent to info@blusbarbeque.com.

RULES — read carefully:
1. Extract ONLY information EXPLICITLY stated in the email. Do NOT infer, guess, or fill in blanks.
2. If a field is not mentioned in the email, set it to null. Never make up a value.
3. Normalize dates to ISO 8601 (YYYY-MM-DD). If only a month/year is mentioned with no day, return null.
4. Normalize phone numbers to E.164 (+1XXXXXXXXXX for US). If it cannot be normalized, return as-written. If not mentioned, null.
5. menu_preferences: array of food items mentioned (e.g. ["brisket", "mac and cheese"]). null if none mentioned.
6. dietary_restrictions: array of dietary needs mentioned (e.g. ["vegetarian", "gluten-free"]). null if none mentioned.
7. event_type: one of "wedding", "corporate", "birthday", "graduation", "party", "funeral", "other". null if unclear.
8. budget: numeric dollar amount only. If a range like "$2000-3000", use the midpoint (2500). null if not mentioned.
9. special_requests: any other specific asks not captured in other fields. null if none.
10. missing_fields: array of field names you set to null (required — helps us draft follow-up emails).

Return ONLY valid JSON. No explanation, no markdown fences, no extra text before or after the JSON object.

JSON schema (return exactly this structure):
{
  "customer_name": "string or null",
  "customer_email": "string or null",
  "customer_phone": "string or null",
  "event_date": "YYYY-MM-DD or null",
  "event_time": "string or null",
  "event_type": "string or null",
  "guest_count": "number or null",
  "venue_name": "string or null",
  "venue_address": "string or null",
  "menu_preferences": ["array of strings"] or null,
  "dietary_restrictions": ["array of strings"] or null,
  "budget": "number or null",
  "special_requests": "string or null",
  "missing_fields": ["array of field names that are null"]
}`;

function callAnthropic(apiKey, emailBody, subject, from, date) {
  const userContent = [
    'From: ' + from,
    'Date: ' + date,
    'Subject: ' + subject,
    '',
    emailBody
  ].join('\n');

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody),
      }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(55000, () => { req.destroy(new Error('Anthropic API timeout after 55s')); });
    req.write(requestBody);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) return res.status(500).json({ error: 'GMAIL_READ_SECRET env var not configured' });
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized — invalid or missing secret' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY env var not configured' });

  let input = req.body;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  input = input || {};

  const { body: emailBody, subject, from, date } = input;
  if (!emailBody) return res.status(400).json({ error: 'body (email text) is required' });

  let anthropicResp;
  try {
    anthropicResp = await callAnthropic(apiKey, emailBody, subject || '', from || '', date || '');
  } catch (e) {
    return res.status(502).json({ error: 'Anthropic API request failed', detail: e.message });
  }

  if (anthropicResp.status >= 300) {
    return res.status(502).json({
      error: 'Anthropic API error ' + anthropicResp.status,
      detail: anthropicResp.body
    });
  }

  const rawText = (anthropicResp.body.content && anthropicResp.body.content[0] &&
                   anthropicResp.body.content[0].text) || '';

  let extracted;
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    extracted = JSON.parse(jsonStr);
  } catch (e) {
    return res.status(502).json({
      error: 'Claude returned non-JSON response',
      raw: rawText.slice(0, 500),
      detail: e.message
    });
  }

  const EXPECTED_FIELDS = [
    'customer_name', 'customer_email', 'customer_phone',
    'event_date', 'event_time', 'event_type', 'guest_count',
    'venue_name', 'venue_address', 'menu_preferences',
    'dietary_restrictions', 'budget', 'special_requests'
  ];
  if (!Array.isArray(extracted.missing_fields)) {
    extracted.missing_fields = EXPECTED_FIELDS.filter(f => extracted[f] == null);
  }

  return res.status(200).json({
    ok: true,
    extracted,
    model: 'claude-sonnet-4-6',
    input_tokens: anthropicResp.body.usage && anthropicResp.body.usage.input_tokens,
    output_tokens: anthropicResp.body.usage && anthropicResp.body.usage.output_tokens,
    extractedAt: new Date().toISOString(),
  });
};
