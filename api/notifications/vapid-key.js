/* ===== MODULE: VAPID PUBLIC KEY ENDPOINT
   GET /api/notifications/vapid-key
   Returns the VAPID public key needed by the browser to subscribe.
   The public key is not secret — safe to expose without authentication.
   ===== */
'use strict';

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  if (!publicKey) {
    return res.status(503).json({
      error: 'Push notifications not configured',
      setup: 'Run: npx web-push generate-vapid-keys then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel env',
    });
  }
  return res.status(200).json({ ok: true, publicKey });
};
