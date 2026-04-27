/* ===== MODULE: DEPOSITS LIST
   GET /api/deposits/list?secret=...&threadId=...
   Returns all recorded deposits for a given inquiry (by threadId).

   Reads via api/_lib/data/deposits.js — Phase 1 migration scaffolding.
   The entity module currently delegates to KV; Phase N will dual-write.
   KV key: deposits:{threadId} → JSON array of deposit records.
   ===== */
'use strict';
const { listDepositsByThread } = require('../_lib/data/deposits.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secret   = q.secret;
  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId } = q;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  try {
    const deposits = await listDepositsByThread(threadId);
    return res.status(200).json({ ok: true, deposits });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
