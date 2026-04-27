/* ===== ENTITY MODULE — INQUIRIES
   Phase 1: KV-only. Delegates to the same KV keys the existing
   api/inquiries/* handlers read and write.

   KV shape (existing):
     inquiries:index           → JSON array of summary objects (max 500, newest-first)
     inquiries:{threadId}      → full inquiry record

   Phase N target schema (Postgres):
     inquiries(thread_id PK, customer_email, customer_name, event_date,
       guests, status, approved, created_at, updated_at, raw jsonb)
   Index becomes a SELECT — we keep it in KV during cutover via materialized
   list, then drop the KV key once pg_reads_inquiries is ON.

   This stub is intentionally read/write thin — large parts of the
   inquiry lifecycle (approve, archive, send-now, etc.) currently live
   inside their respective handlers and will move here as we migrate.
   ===== */
'use strict';
const { kvGet, kvSet } = require('./_kv.js');

const INDEX_KEY = 'inquiries:index';
const RECORD_KEY = threadId => 'inquiries:' + threadId;

async function getInquiry(threadId) {
  if (!threadId) throw new Error('threadId required');
  const raw = await kvGet(RECORD_KEY(threadId)).catch(() => null);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function setInquiry(threadId, record) {
  if (!threadId) throw new Error('threadId required');
  if (!record || typeof record !== 'object') throw new Error('record must be an object');
  // TODO Phase N: dual-write to Postgres inquiries table when pg_writes_enabled is ON.
  await kvSet(RECORD_KEY(threadId), record);
  return record;
}

async function listInquiries() {
  const raw = await kvGet(INDEX_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setInquiriesIndex(index) {
  if (!Array.isArray(index)) throw new Error('index must be an array');
  // TODO Phase N: index becomes a SELECT once pg_reads_inquiries is ON;
  // dual-write keeps KV warm during cutover.
  await kvSet(INDEX_KEY, index);
  return index;
}

module.exports = { getInquiry, setInquiry, listInquiries, setInquiriesIndex, INDEX_KEY, RECORD_KEY };
