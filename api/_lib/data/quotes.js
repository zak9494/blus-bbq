/* ===== ENTITY MODULE — QUOTES
   Phase 1: KV-only. Quotes are currently embedded inside inquiry records
   under the `quote` field; standalone quote storage (drafts, templates)
   lives at:
     quotes:draft:{threadId}      → in-progress Quote Builder draft
     quotes:template:{id}         → saved Quote Builder template
     quotes:templates:_index      → JSON array of template ids

   Phase N target schema (Postgres):
     quotes(thread_id PK, version, total_cents, items jsonb, created_at)
     quote_templates(id PK, name, items jsonb, created_at, updated_at)

   We keep this stub intentionally minimal — Phase 2 dual-writes start
   with notifications, deposits, and inquiries; quotes follow once those
   are stable.
   ===== */
'use strict';
const { kvGet, kvSet } = require('./_kv.js');

const DRAFT_KEY    = threadId => 'quotes:draft:' + threadId;
const TEMPLATE_KEY = id        => 'quotes:template:' + id;
const TEMPLATE_INDEX_KEY = 'quotes:templates:_index';

async function getDraft(threadId) {
  if (!threadId) throw new Error('threadId required');
  const raw = await kvGet(DRAFT_KEY(threadId)).catch(() => null);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

async function setDraft(threadId, draft) {
  if (!threadId) throw new Error('threadId required');
  if (!draft || typeof draft !== 'object') throw new Error('draft must be an object');
  // TODO Phase N: dual-write to Postgres quotes table when pg_writes_enabled is ON.
  await kvSet(DRAFT_KEY(threadId), draft);
  return draft;
}

async function listTemplates() {
  const rawIdx = await kvGet(TEMPLATE_INDEX_KEY).catch(() => null);
  let ids = [];
  try { ids = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];
  const records = await Promise.all(ids.map(async id => {
    const raw = await kvGet(TEMPLATE_KEY(id)).catch(() => null);
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  }));
  return records.filter(Boolean);
}

module.exports = { getDraft, setDraft, listTemplates, DRAFT_KEY, TEMPLATE_KEY, TEMPLATE_INDEX_KEY };
