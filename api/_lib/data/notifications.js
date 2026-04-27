/* ===== ENTITY MODULE — NOTIFICATIONS
   Phase 1: KV-only. Delegates to existing api/_lib/notifications.js
   helpers via direct KV access on the same keys.

   KV shape (existing):
     notifications:list  → JSON array of notification objects (newest first)
     push:subscriptions  → JSON array of Web Push subscription objects

   Notification object shape (from api/_lib/notification-types.js):
     { id, type, title, body, ts, read, threadId?, dedupeKey? }

   Phase 2 (notifications is the FIRST entity to dual-write per the
   migration plan): introduce schema
     notifications(id, type, title, body, ts, read, thread_id, dedupe_key)
   and dual-write here when pg_writes_enabled=true. Cut over reads
   when pg_reads_notifications=true.

   This module exists primarily as a Phase 2 hook point. The full
   notifications API is in api/_lib/notifications.js — we only re-expose
   getList/setList here so dual-write logic has a single place to land.
   ===== */
'use strict';
const { kvGet, kvSet } = require('./_kv.js');

const LIST_KEY = 'notifications:list';
const SUBS_KEY = 'push:subscriptions';

async function listNotifications() {
  const raw = await kvGet(LIST_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setNotifications(list) {
  if (!Array.isArray(list)) throw new Error('notifications must be an array');
  // TODO Phase 2: dual-write each row to Postgres when pg_writes_enabled is ON.
  await kvSet(LIST_KEY, list);
  return list;
}

async function listSubscriptions() {
  const raw = await kvGet(SUBS_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setSubscriptions(subs) {
  if (!Array.isArray(subs)) throw new Error('subscriptions must be an array');
  // TODO Phase 2: dual-write to Postgres push_subscriptions table.
  await kvSet(SUBS_KEY, subs);
  return subs;
}

module.exports = { listNotifications, setNotifications, listSubscriptions, setSubscriptions, LIST_KEY, SUBS_KEY };
