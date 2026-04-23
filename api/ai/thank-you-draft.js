/**
 * POST /api/ai/thank-you-draft
 * Generates a post-event thank-you email draft for a completed booking.
 * Optionally includes a future-discount offer. Does NOT send — returns draft only.
 *
 * Body: { inquiryId, discountAmount?, discountThreshold?, discountExpiry? }
 * Auth: GMAIL_READ_SECRET
 *
 * Returns: { ok, subject, body, model, input_tokens, output_tokens }
 */
module.exports.config = { maxDuration: 30 };

const https = require('https');
const { businessConfig } = require('../_lib/business-config.js');

const MODEL = 'claude-sonnet-4-6';

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

function secretGate(req, res) {
  const secret   = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) { res.status(500).json({ error: 'GMAIL_READ_SECRET not configured' }); return false; }
  if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

function buildThankYouSystemPrompt() {
  return `You are ${businessConfig.ownerName}, owner of ${businessConfig.name} in ${businessConfig.city}, ${businessConfig.state} (phone: ${businessConfig.phone}).
Write a warm, genuine post-event thank-you email to a catering customer.
Tone: heartfelt, personal, celebratory. Keep it under 180 words.

Rules:
- Open with "Hi [FirstName],"
- Thank them for choosing ${businessConfig.name} for their event
- Express how much you enjoyed being part of their celebration
- If a discount offer is included, mention it warmly and naturally with the exact placeholders provided
- Invite them to leave a Google review if they loved it
- Invite them to come by the restaurant anytime (Wed\u2013Sun after 1 PM)
- Close with your name, ${businessConfig.name}, and ${businessConfig.phone}
- Plain text only \u2014 no markdown, no bullet symbols, just line breaks`;
}

function buildDiscountSection(discountAmount, discountThreshold, discountExpiry) {
  if (!discountAmount && !discountThreshold) return '';
  let text = '\n\nAs a thank-you for your business, ';
  if (discountAmount && discountThreshold) {
    text += `we'd love to offer you $${discountAmount} off your next event of $${discountThreshold} or more`;
  } else if (discountAmount) {
    text += `we'd love to offer you $${discountAmount} off your next catering order`;
  } else if (discountThreshold) {
    text += `we'd love to offer you a special discount on your next event of $${discountThreshold} or more`;
  }
  if (discountExpiry) text += ` (valid through ${discountExpiry})`;
  text += '. Just mention this email when you reach out!';
  return text;
}

async function callClaude(systemPrompt, userMsg) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const body = JSON.stringify({
    model: MODEL, max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
  });
  return new Promise((resolve, reject) => {
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
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const { inquiryId, discountAmount, discountThreshold, discountExpiry } = body;
  if (!inquiryId) return res.status(400).json({ error: 'inquiryId is required' });

  let inquiry;
  try {
    const raw = await kvGet('inquiries:' + inquiryId);
    if (!raw) return res.status(404).json({ error: 'Inquiry not found: ' + inquiryId });
    inquiry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load inquiry: ' + e.message });
  }

  const ef = inquiry.extracted_fields || {};
  const firstName = ((ef.customer_name || '').split(' ')[0]) || 'there';
  const eventInfo = [
    ef.event_type  ? 'Event type: ' + ef.event_type : null,
    ef.event_date  ? 'Event date: ' + ef.event_date  : null,
    ef.guest_count ? 'Guests: '     + ef.guest_count : null,
    ef.venue_name  ? 'Venue: '      + ef.venue_name  : null,
  ].filter(Boolean).join(', ');

  const discountSection = buildDiscountSection(discountAmount, discountThreshold, discountExpiry);

  const userMsg = `Customer first name: ${firstName}
${eventInfo ? 'Event: ' + eventInfo : ''}${discountSection ? '\nDiscount to include:' + discountSection : ''}

Please write the thank-you email now.`;

  try {
    const result = await callClaude(buildThankYouSystemPrompt(), userMsg);
    if (result.error || !result.content) {
      return res.status(500).json({ error: 'Claude API error', detail: result.error || result });
    }
    const name = ef.customer_name || 'Your Event';
    return res.status(200).json({
      ok: true,
      subject: 'Thank You from ' + businessConfig.name + ' \u2014 ' + name,
      body: result.content[0].text.trim(),
      model: result.model,
      input_tokens:  result.usage && result.usage.input_tokens,
      output_tokens: result.usage && result.usage.output_tokens,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Draft generation failed', detail: e.message });
  }
};
