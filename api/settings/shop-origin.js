/* ===== SETTINGS: Shop Origin Address
   GET  /api/settings/shop-origin          → { address: string | null }
   POST /api/settings/shop-origin          → body { secret, address } → { ok, address }
   KV key: settings:shop_origin_address
   GET is unauthenticated — value is display-only (no PII beyond a business address).
   POST requires SELF_MODIFY_SECRET.
   ===== */
'use strict';
const { getShopOriginAddress, setShopOriginAddress } = require('../_lib/shop-origin.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const address = await getShopOriginAddress();
    return res.status(200).json({ address: address || null });
  }

  if (req.method === 'POST') {
    const body     = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
    if (!expected || body.secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    const address = (body.address || '').trim();
    try {
      await setShopOriginAddress(address);
      return res.status(200).json({ ok: true, address: address || null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
