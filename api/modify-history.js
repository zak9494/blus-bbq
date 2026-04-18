const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const history = (await kv.get('modify-history')) || [];
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
      const existing = (await kv.get('modify-history')) || [];
      const updated = [entry, ...existing].slice(0, 30);
      await kv.set('modify-history', updated);
      return res.status(200).json({ ok: true, entry });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err && err.message || String(err) });
  }
};
