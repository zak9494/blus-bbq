/* ===== ENTITY MODULE — DEPOSITS
   Phase 1: KV-only. All reads/writes still go through Upstash via _kv.js.

   Phase 2/3 plan (TODO):
   - When pg_writes_enabled flag is ON, setDeposits() will dual-write to
     Postgres after the KV write succeeds. KV remains the source of truth
     until the per-entity read flag (pg_reads_deposits) is flipped.
   - When pg_reads_deposits is ON, getDeposits()/listDepositsByThread()
     reads from Postgres and falls back to KV on miss.
   - Schema (see migrations/, Phase 2): deposits(thread_id, idx, amount,
     received_at, tx_id, ...). Existing KV shape:
       deposits:{threadId} → JSON array of { amount, date, txId, note }

   Why this exists in Phase 1 even though it's a no-op:
   - It establishes the abstraction so Phase 2-N can swap implementations
     without touching the handlers that import this module.
   - It documents the entity's KV shape and Postgres target shape in
     one place.
   ===== */
'use strict';
const { kvGet, kvSet } = require('./_kv.js');

const KEY = threadId => 'deposits:' + threadId;

async function listDepositsByThread(threadId) {
  if (!threadId) throw new Error('threadId required');
  const raw = await kvGet(KEY(threadId)).catch(() => null);
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setDepositsForThread(threadId, deposits) {
  if (!threadId) throw new Error('threadId required');
  if (!Array.isArray(deposits)) throw new Error('deposits must be an array');
  // TODO Phase 2: dual-write to Postgres when pg_writes_enabled is ON.
  await kvSet(KEY(threadId), deposits);
  return deposits;
}

module.exports = { listDepositsByThread, setDepositsForThread, KEY };
