const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HISTORY_KEY = 'modify-history';

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(KV_URL + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  });
  const d = await r.json();
  if (d.result === null || d.result === undefined) return null;
  try { return JSON.parse(d.result); } catch(e) { return d.result; }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  const r = await fetch(KV_URL + '/set/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  return r.ok;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const history = (await kvGet(HISTORY_KEY)) || [];
      return res.status(200).json({ ok: true, history });
    }

    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
      const entry = {
        id: Date.now().toString(),
        title: (body.title || 'Dashboard update').toString().slice(0, 200),
        status: body.status || 'done',
        sha: body.sha || null,
        error: body.error || null,
        timestamp: new Date().toISOString(),
      };
      const rawExisting = (await kvGet(HISTORY_KEY)) || [];
      const existing = Array.isArray(rawExisting) ? rawExisting : [];
      const updated = [entry, ...existing].slice(0, 30);
      await kvSet(HISTORY_KEY, updated);
      return res.status(200).json({ ok: true, entry });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err && err.message || String(err) });
  }
};
