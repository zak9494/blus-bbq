/**
 * POST /api/sms/send
 * SMS outreach — gated on sms_channel feature flag.
 *
 * Sends via Twilio when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
 * are all set. When any env var is absent the message is logged to stdout only
 * (stub/dev mode) so the scaffold is safe to deploy before Twilio 10DLC is cleared.
 *
 * Body: { to: "+1XXXXXXXXXX", body: "message text", threadId?: "..." }
 * Response: { ok, sid?, mode: "twilio"|"stub", to, ts }
 *
 * Secret gate: ?secret=GMAIL_READ_SECRET or X-Secret header (reuses existing secret).
 */

const https = require('https');
const { getFlag } = require('../_lib/flags');

function twilioSend(accountSid, authToken, from, to, body) {
  const formData = new URLSearchParams({ To: to, From: from, Body: body }).toString();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData),
      },
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(formData);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) return res.status(500).json({ error: 'GMAIL_READ_SECRET env var not configured' });
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const enabled = await getFlag('sms_channel');
  if (!enabled) return res.status(403).json({ error: 'sms_channel flag is OFF' });

  const { to, body, threadId } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  if (!/^\+1\d{10}$/.test(to)) return res.status(400).json({ error: 'to must be E.164 format: +1XXXXXXXXXX' });

  const ts = new Date().toISOString();
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  const twilioReady = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER;

  if (!twilioReady) {
    console.log(`[sms/send] STUB mode — Twilio env vars not set. Would send to ${to}: "${body}" (threadId=${threadId || 'n/a'})`);
    return res.status(200).json({ ok: true, mode: 'stub', to, ts });
  }

  let result;
  try {
    result = await twilioSend(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, to, body);
  } catch (e) {
    return res.status(502).json({ error: 'Twilio request failed', detail: e.message });
  }

  if (result.status >= 300) {
    return res.status(502).json({
      error: `Twilio error ${result.status}`,
      detail: result.body,
    });
  }

  return res.status(200).json({ ok: true, mode: 'twilio', sid: result.body.sid, to, ts });
};
