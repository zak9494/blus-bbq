/**
 * POST /api/ai/add-details
 * Appends extra context to an existing draft and regenerates. Thin wrapper
 * over /api/ai/regenerate kept as a separate endpoint for UI clarity.
 *
 * Body: { inquiryId, draftType: 'email'|'quote_reply'|'text', extraContext, existingDraft? }
 * Auth: GMAIL_READ_SECRET via x-secret header or ?secret= query param
 *
 * Returns: { ok, subject?, body, draftType, model, input_tokens, output_tokens }
 */
module.exports.config = { maxDuration: 30 };

const https = require('https');
const { generateDraft } = require('../_lib/ai-draft.js');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!secretGate(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const { inquiryId, draftType, extraContext, existingDraft } = body;
  if (!inquiryId)    return res.status(400).json({ error: 'inquiryId is required' });
  if (!draftType)    return res.status(400).json({ error: 'draftType is required (email|quote_reply|text)' });
  if (!extraContext) return res.status(400).json({ error: 'extraContext is required' });

  let inquiry;
  try {
    const raw = await kvGet('inquiries:' + inquiryId);
    if (!raw) return res.status(404).json({ error: 'Inquiry not found: ' + inquiryId });
    inquiry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load inquiry: ' + e.message });
  }

  try {
    const draft = await generateDraft({ inquiry, draftType, addedContext: extraContext, existingDraft });
    return res.status(200).json({ ok: true, ...draft });
  } catch (e) {
    return res.status(500).json({ error: 'Draft generation failed', detail: e.message });
  }
};
