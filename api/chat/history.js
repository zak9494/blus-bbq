/* ===== MODULE: CHAT HISTORY (C21)
   GET  /api/chat/history?secret=...      → { ok, messages: [...] }
   POST /api/chat/history                 → body { secret, messages: [...] }
   Persists AI chat history in KV for session continuity across reloads.

   Persists via api/_lib/data/chat.js — Phase 1 migration scaffolding.
   The entity module currently delegates to KV; Phase N will dual-write.
   KV key: chat:history  (single-user system; max 100 messages stored).
   ===== */
'use strict';
const { getHistory, setHistory } = require('../_lib/data/chat.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;

  if (req.method === 'GET') {
    const secret = (req.query || {}).secret;
    if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const messages = await getHistory();
      return res.status(200).json({ ok: true, messages });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }

  if (req.method === 'POST') {
    const body   = req.body || {};
    const secret = body.secret;
    if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });
    let messages = body.messages;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });
    messages = messages.map(function(m) { return { role: m.role, content: m.content }; });
    try {
      const stored = await setHistory(messages);
      return res.status(200).json({ ok: true, count: stored.length });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
