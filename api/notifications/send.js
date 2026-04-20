/* ===== MODULE: PUSH NOTIFICATION SENDER
   POST /api/notifications/send
   Body: { secret, title, body, url?, tag? }
   Sends a Web Push notification to all stored subscriptions using VAPID.

   Required Vercel env vars (set once):
     VAPID_PUBLIC_KEY  — base64url-encoded P-256 public key
     VAPID_PRIVATE_KEY — base64url-encoded P-256 private key
     VAPID_SUBJECT     — mailto: or https: URL (default: mailto:info@blusbarbeque.com)

   To generate VAPID keys:
     npx web-push generate-vapid-keys
   Then paste them into Vercel → Settings → Environment Variables.
   ===== */
'use strict';

const https  = require('https');
const crypto = require('crypto');

const KV_KEY = 'push:subscriptions';

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

async function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* ── VAPID JWT signing (no external deps — uses built-in Node crypto) ───── */
function base64urlEncode(buf) {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeVapidJWT(audience, subject, vapidPrivateKeyB64) {
  const now = Math.floor(Date.now() / 1000);
  const header  = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64urlEncode(JSON.stringify({ aud: audience, exp: now + 43200, sub: subject }));
  const sigInput = Buffer.from(header + '.' + payload);
  // Import P-256 private key from raw base64url bytes
  const keyBytes = Buffer.from(vapidPrivateKeyB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex'),
      keyBytes,
    ]),
    format: 'der', type: 'pkcs8',
  });
  const sigBuf = crypto.sign('SHA256', sigInput, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return header + '.' + payload + '.' + base64urlEncode(sigBuf);
}

async function sendPushToSubscription(sub, payloadStr, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  return new Promise(async (resolve, reject) => {
    try {
      const endpoint = new URL(sub.endpoint);
      const audience  = endpoint.protocol + '//' + endpoint.host;
      const jwt = await makeVapidJWT(audience, vapidSubject, vapidPrivateKey);
      const auth = 'vapid t=' + jwt + ',k=' + vapidPublicKey;

      // Encrypt payload using ECDH + AES-GCM (aesgcm / RFC 8291 draft)
      // For simplicity, send an unencrypted push if keys not available.
      // If sub has keys (auth + p256dh), we must encrypt. Use RFC 8188 / draft-ietf-webpush-encryption.
      // Full RFC 8291 encryption is complex — use the web-push package if available,
      // otherwise fallback to empty push (client shows notification via push event data).

      let webpush;
      try { webpush = require('web-push'); } catch(e) { webpush = null; }

      if (webpush) {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        const result = await webpush.sendNotification(sub, payloadStr);
        resolve({ ok: true, status: result.statusCode });
        return;
      }

      // Fallback: raw HTTPS request without payload encryption (works if sub has no keys,
      // or push service accepts empty body — browser will fire 'push' event with no data)
      const bodyBuf = Buffer.from(payloadStr, 'utf-8');
      const headers = {
        'Authorization': auth,
        'Content-Type': 'application/octet-stream',
        'Content-Length': bodyBuf.length,
        'TTL': '86400',
      };
      const req = https.request({
        hostname: endpoint.hostname,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers,
      }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => {
          if (r.statusCode >= 400) reject({ statusCode: r.statusCode, body: d });
          else resolve({ ok: true, status: r.statusCode });
        });
      });
      req.on('error', reject);
      req.write(bodyBuf);
      req.end();
    } catch(e) { reject(e); }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const body   = req.body || {};
  if (!secret || body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject    = process.env.VAPID_SUBJECT || 'mailto:info@blusbarbeque.com';

  if (!vapidPublicKey || !vapidPrivateKey) {
    return res.status(503).json({
      error: 'Push notifications not configured',
      setup: 'Run: npx web-push generate-vapid-keys then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel env vars',
    });
  }

  const payload = JSON.stringify({
    title: body.title || "Blu's BBQ",
    body:  body.body  || '',
    url:   body.url   || '/',
    tag:   body.tag   || 'blus-notif',
  });

  try {
    const raw  = await kvGet(KV_KEY);
    const subs = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'No subscribers' });

    const results = await Promise.allSettled(
      subs.map(sub => sendPushToSubscription(sub, payload, vapidPublicKey, vapidPrivateKey, vapidSubject))
    );

    // Collect expired endpoints (410/404 → subscription gone)
    const expired = new Set();
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const sc = r.reason && r.reason.statusCode;
        if (sc === 410 || sc === 404) expired.add(subs[i].endpoint);
      }
    });
    if (expired.size > 0) {
      const cleaned = subs.filter(s => !expired.has(s.endpoint));
      await kvSet(KV_KEY, JSON.stringify(cleaned));
    }

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    return res.status(200).json({ ok: true, sent, failed, total: subs.length, expired: expired.size });
  } catch(err) { return res.status(500).json({ error: err && err.message || String(err) }); }
};
