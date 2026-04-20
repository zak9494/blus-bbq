/* ===== MODULE: PUSH SUBSCRIPTION MANAGER =====
   GET  /api/notifications/subscribe           -> list count
   POST /api/notifications/subscribe           -> store subscription
   DELETE /api/notifications/subscribe?purge=1 -> wipe all (admin)
*/

const KV_KEY = 'push:subscriptions';

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }
function secret()  { return process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN; }

async function kvGet(key) {
  const r = await fetch(`${kvUrl()}/get/${key}`, {
    headers: { Authorization: `Bearer ${kvToken()}` }
  });
  const j = await r.json();
  return j.result;
}

async function kvSet(key, value) {
  const r = await fetch(`${kvUrl()}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  return r.json();
}

function validateSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string') {
    return 'subscription.endpoint must be a string';
  }
  try { new URL(sub.endpoint); } catch(e) {
    return 'subscription.endpoint is not a valid URL';
  }
  if (!sub.endpoint.startsWith('https://')) {
    return 'subscription.endpoint must be https';
  }
  if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
    return 'subscription.keys.p256dh and subscription.keys.auth are required strings';
  }
  const p256dhBuf = Buffer.from(
    sub.keys.p256dh.replace(/-/g, '+').replace(/_/g, '/'), 'base64'
  );
  if (p256dhBuf.length !== 65) {
    return 'subscription.keys.p256dh must decode to 65 bytes (got ' + p256dhBuf.length + ')';
  }
  const authBuf = Buffer.from(
    sub.keys.auth.replace(/-/g, '+').replace(/_/g, '/'), 'base64'
  );
  if (authBuf.length !== 16) {
    return 'subscription.keys.auth must decode to 16 bytes (got ' + authBuf.length + ')';
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const q = req.query || {};

    if (req.method === 'GET') {
      const raw = await kvGet(KV_KEY);
      const subs = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ ok: true, count: subs.length });
    }

    if (req.method === 'DELETE') {
      if (q.secret !== secret()) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (q.purge === '1') {
        await kvSet(KV_KEY, JSON.stringify([]));
        return res.status(200).json({ ok: true, purged: true });
      }
      return res.status(400).json({ ok: false, error: 'Missing purge=1' });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.secret !== secret()) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const sub = body.subscription;
      const validationError = validateSubscription(sub);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
      const raw = await kvGet(KV_KEY);
      const subs = raw ? JSON.parse(raw) : [];
      const exists = subs.some(s => s.endpoint === sub.endpoint);
      if (!exists) {
        subs.push(sub);
        await kvSet(KV_KEY, JSON.stringify(subs));
      }
      return res.status(200).json({ ok: true, stored: !exists, total: subs.length });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch(err) {
    console.error('[subscribe] error:', err);
    return res.status(500).json({ ok: false, error: err && err.message || String(err) });
  }
}
