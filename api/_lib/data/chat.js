/* ===== ENTITY MODULE — CHAT
   Phase 1: KV-only. Existing handlers in api/chat/ read these keys
   directly; this module re-exposes the same access pattern so Phase 2
   dual-writes have one landing point.

   KV shape (existing):
     chat:history          → JSON array of { role, content, ts } (max 100)
     chat:approval:queue   → JSON array of draft items awaiting approval (max 20)

   Phase N target schema (Postgres):
     chat_messages(id PK, role, content, ts, thread_id)
     chat_approvals(id PK, draft jsonb, created_at, status)
   ===== */
'use strict';
const { kvGet, kvSet } = require('./_kv.js');

const HISTORY_KEY  = 'chat:history';
const APPROVAL_KEY = 'chat:approval:queue';
const HISTORY_MAX  = 100;
const APPROVAL_MAX = 20;

async function getHistory() {
  const raw = await kvGet(HISTORY_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function setHistory(messages) {
  if (!Array.isArray(messages)) throw new Error('messages must be an array');
  const trimmed = messages.slice(-HISTORY_MAX);
  // TODO Phase N: dual-write to Postgres chat_messages when pg_writes_enabled is ON.
  await kvSet(HISTORY_KEY, trimmed);
  return trimmed;
}

async function getApprovalQueue() {
  const raw = await kvGet(APPROVAL_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function setApprovalQueue(queue) {
  if (!Array.isArray(queue)) throw new Error('queue must be an array');
  const trimmed = queue.slice(0, APPROVAL_MAX);
  // TODO Phase N: dual-write to Postgres chat_approvals when pg_writes_enabled is ON.
  await kvSet(APPROVAL_KEY, trimmed);
  return trimmed;
}

module.exports = {
  getHistory, setHistory, getApprovalQueue, setApprovalQueue,
  HISTORY_KEY, APPROVAL_KEY, HISTORY_MAX, APPROVAL_MAX,
};
