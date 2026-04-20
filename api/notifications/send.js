/* ===== MODULE: PUSH NOTIFICATION SENDER
   POST /api/notifications/send
   Body: { secret, title, body, url?, tag? }
   Sends a Web Push notification to all stored subscriptions using VAPID.

   Required Vercel env vars:
     VAPID_PUBLIC_KEY  - base64url-encoded P-256 public key
     VAPID_PRIVATE_KEY - base64url-encoded P-256 private key
     VAPID_SUBJECT     - mailto: or https: URL (default: mailto:info@blusbarbeque.com)

   To generate VAPID keys:
     npx web-push generate-vapid-keys
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

/* -- VAPID JWT signing (fallback only - used when web-push package unavailable) */
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

/* -- Determine if an error means the subscription should be permanently removed */
function isPermanentError(err) {
  if (!err) return false;
  // 410 Gone / 404 Not Found = subscription deleted at push service
  if (err.statusCode === 410 || err.statusCode === 404) return true;
  // 403 Forbidden = push service permanently rejects (e.g. after VAPID key rotation)
  if (err.statusCode === 403) return true;
  // 400 with body indicating the subscription record itself is invalid;
  // includes VapidPkHashMismatch (stale sub from a previous VAPID key set)
  if (err.statusCode === 400 && err.body &&
      /p256dh|invalid|bad|malformed|VapidPkHashMismatch/i.test(String(err.body))) return true;
  // Encryption failure before HTTP: bad p256dh/auth keys stored in KV
  if (!err.statusCode && err.message &&
      /p256dh.*bytes|auth.*bytes/i.test(err.message)) return true;
  return false;
}

async function sendPushToSubscription(sub, payloadStr, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  // -- Use web-push when available: handles ECDH payload encryption + VAPID JWT --
  let webpush;
  try { webpush = require('web-push'); } catch(e) { webpush = null; }

  if (webpush) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const result = await webpush.sendNotification(sub, payloadStr);
    return { ok: true, status: result.statusCode };
  }

  // -- Fallback: manual VAPID JWT + raw HTTPS (no payload encryption) -----------
  // NOTE: Chrome/Firefox require payload encryption; this path is a last resort
  // that works only when the push service accepts empty-body pushes.
  const endpoint = new URL(sub.endpoint);
  const audience = endpoint.protocol + '//' + endpoint.host;
  const jwt  = await makeVapidJWT(audience, vapidSubject, vapidPrivateKey);
  const auth = 'vapid t=' + jwt + ',k=' + vapidPublicKey;

  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(payloadStr, 'utf-8');
    const req = https.request({
      hostname: endpoint.hostname,
      path:     endpoint.pathname + endpoint.search,
      method:   'POST',
      headers: {
        'Authorization':  auth,
        'Content-Type':   'application/octet-stream',
        'Content-Length': bodyBuf.length,
        'TTL':            '86400',
      },
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

    // Collect endpoints to purge (expired OR permanently invalid)
    const toRemove = new Set();
    const errorDetails = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const sc  = r.reason && r.reason.statusCode;
        const msg = r.reason && (r.reason.body || r.reason.message || String(r.reason));
        console.error('[push-fail] idx=' + i + ' sc=' + sc + ' err=' + JSON.stringify(msg));
        errorDetails.push({ idx: i, sc, err: String(msg).slice(0, 200) });
        if (isPermanentError(r.reason)) toRemove.add(subs[i].endpoint);
      }
    });

    if (toRemove.size > 0) {
      console.log('[push-cleanup] removing ' + toRemove.size + ' permanently-failed subscription(s)');
      const cleaned = subs.filter(s => !toRemove.has(s.endpoint));
      await kvSet(KV_KEY, JSON.stringify(cleaned));
    }

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    return res.status(200).json({
      ok: true, sent, failed, total: subs.length,
      removed: toRemove.size,
      ...(failed > 0 ? { errors: errorDetails } : {}),
    });
  } catch(err) { return res.status(500).json({ error: err && err.message || String(err) }); }
};
