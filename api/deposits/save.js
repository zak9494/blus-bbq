/* ===== MODULE: DEPOSITS SAVE
   POST /api/deposits/save
   Body: { secret, threadId, deposit: { id?, amount, date, method, note } }
         action 'delete': { secret, threadId, depositId }
   Records, updates, or deletes a deposit entry for an inquiry.

   Persists via api/_lib/data/deposits.js — Phase 1 migration scaffolding.
   The entity module currently delegates to KV; Phase N will dual-write.
   KV key: deposits:{threadId} → JSON array of deposit records.

   Deposit record shape:
     { id, amount (number), date (YYYY-MM-DD), method (string), note (string), recordedAt (ISO) }
   ===== */
'use strict';
const { listDepositsByThread, setDepositsForThread } = require('../_lib/data/deposits.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  const secret   = body.secret;
  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const { threadId, action, depositId, deposit } = body;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  try {
    let deposits = await listDepositsByThread(threadId);

    if (action === 'delete') {
      if (!depositId) return res.status(400).json({ error: 'depositId required for delete' });
      deposits = deposits.filter(d => d.id !== depositId);
    } else {
      if (!deposit) return res.status(400).json({ error: 'deposit object is required' });
      const amount = parseFloat(deposit.amount);
      if (!amount || amount <= 0) return res.status(400).json({ error: 'deposit.amount must be > 0' });

      const id = deposit.id || ('dep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
      const record = {
        id,
        amount:     Math.round(amount * 100) / 100,
        date:       deposit.date || new Date().toISOString().slice(0, 10),
        method:     (deposit.method || 'other').slice(0, 50),
        note:       (deposit.note   || '').slice(0, 200),
        recordedAt: new Date().toISOString(),
      };
      const idx = deposits.findIndex(d => d.id === id);
      if (idx >= 0) { deposits[idx] = record; }
      else          { deposits.push(record); }
    }

    await setDepositsForThread(threadId, deposits);
    const totalPaid = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    return res.status(200).json({ ok: true, deposits, totalPaid: Math.round(totalPaid * 100) / 100 });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
