# Upstash KV → Postgres Migration Plan (v1)

**Status:** Scoping doc. Read-only. No migration code yet.
**Target start:** TBD (after review).
**Target completion:** ~8 working days, sequenced.
**Tenant model:** Multi-tenant from day 1. Single hardcoded `tenant_id` until SaaS launch (Q4 2026).

---

## Why now

1. **Upstash free tier (500K commands/day) is exhausted.** Flag toggles silently reverted on refresh until PR #105 made writes loud — but the structural fix is moving relational data off KV.
2. **KV is being used as a database.** Inquiries, invoices, deposits, quotes, customer notes, notification feed, scheduled tasks — all relational, none of which KV is built for. We pay for it with `inquiries:index` blob updates on every write, two-step "load index, slice top N" patterns, no joins, no LIKE/full-text.
3. **SaaS pivot is committed for Q4 2026.** Every relational table needs `tenant_id` from day 1 so we don't backfill it later under tenant load.
4. **Vercel Postgres is already provisioned.** No extra infra to stand up. (See §6 — exact env-var wiring needs confirmation.)

---

## Section 1 — KV inventory

Sourced from `grep -rn "kvGet\|kvSet\|kvDel\|@upstash\|REDIS_REST_URL" api/ static/ scripts/`. Every handler in `api/` inlines its own kvGet/kvSet helper rather than going through a shared abstraction (see §4 — this is the first thing we change).

Notation: **rows estimate** based on current production usage (~200–500 inquiries lifetime, single tenant). **Read freq:** vh = very high (every request), h = high (each page load), m = medium (mutation paths), l = low (admin/cron). **Write freq:** same scale.

### Relational data (MIGRATE → Postgres)

| Key pattern | Used by | Read | Write | Data shape | Est. rows | Migrate? |
|---|---|---|---|---|---|---|
| `inquiries:index` | `inquiries/list.js`, kanban, `pipeline/alerts.js`, `pipeline/overdue.js`, `inquiries/by-email.js`, `inquiries/completed.js`, `events/today.js`, `customer/profile.js`, `_lib/repeat-customer.js`, `_lib/post-event-archive.js`, `cron/poll-inquiries.js`, `cron/mark-completed.js`, `cron/weekly-digest.js`, `orders/mark-lost.js`, `quotes/duplicate.js`, `invoices/lost-reasons.js`, `invoices/summary.js`, `calendar/list.js` | h | m | array of summary entries (~25 fields each) | 200–500 | **YES** — replaced by `SELECT … FROM inquiries WHERE tenant_id = $1` with indexes |
| `inquiries:{threadId}` | `inquiries/get.js`, `save.js`, `archive.js`, `approve.js`, `acknowledge.js`, `process-followup.js`, `thread.js`, `send-now.js`, `quotes/duplicate.js`, `ai/*`, `orders/mark-lost.js`, `notifications/cadence-tick.js`, `events/today.js`, `customer/profile.js`, `cron/mark-completed.js`, `cron/poll-inquiries.js`, `_lib/post-event-archive.js`, `_lib/quote-update-queue.js`, `pipeline/overdue.js` | m | m | full inquiry: extracted_fields, raw_email, quote (JSON), activity_log, history, status flags | 200–500 | **YES** |
| `invoice:{id}` | `invoices/{create,update,payment,void,remind,pdf,export}.js` | m | m | invoice with line items, paid amount, status | 50–300 | **YES** |
| `invoices:index` | `invoices/_lib.js` (`loadIndex`/`saveIndex`), summary | m | m | array of invoice summaries (max 500) | 50–300 | **YES** — replaced by indexed query |
| `deposits:{threadId}` | `deposits/list.js`, `deposits/save.js`, `pipeline/overdue.js` | m | m | array of `{id, amount, date, method, note, recordedAt}` | ~50–200 (1 thread can have N) | **YES** — financial; needs audit/FK to inquiry |
| `chat:history` | `chat/history.js` | h (per AI panel open) | m | array of role/content messages (max 100) | 1 blob, ~100 entries | **YES** — convert to row-per-message |
| `chat:approval:queue` | `chat/approval.js` | m | m | array of draft items (max 20) | 1 blob, ~20 entries | **YES** — convert to row-per-item with status |
| `task:{taskId}` | `schedule.js`, `tasks.js`, `dispatch/email.js` | m | m | scheduled task record (recipient, when, body, dispatched flag) | depends on cadence, ~hundreds active | **YES** — needs status/sent_at columns + index by `scheduled_for` |
| `templates:quotes:_index` + `templates:quotes:{id}` | `quotes/templates.js` | l | l | quote template index + record | < 50 | **YES** |
| `quote_updates:queue` + per-item keys | `_lib/quote-update-queue.js` | l | m | queue items pointing to inquiries needing quote regeneration | low | **YES** — small but relational (FK inquiry) |
| `customer:{email}:notes` | `customer/notes.js`, `customer/profile.js` | m | m | array of `{id, text, author, createdAt}` notes | < 100 customers w/ notes | **YES** — row-per-note |
| `customer:{email}:tags` (in `customers/tags.js`) | `customers/tags.js` | l | l | array of tag strings | < 100 | **YES** — fold into a `customer_tags` table or JSONB |
| `customer:invoices:{customerId}` | `invoices/create.js` | l | m | array of invoice IDs (max 200) | low | **YES** — derivable from `invoices.customer_id` index, can be dropped entirely |
| `notifications:list` (ZSET) + `notifications:item:{id}` + `notifications:unread_count` | `_lib/notifications.js`, `notifications/{counts,index,[id],mark-all-read}.js` | h | m | ZSET of notification IDs (score = ms*1000+seq) + per-item record + counter | depends on usage, ~hundreds active | **YES** — single table, `ORDER BY created_at DESC`, count via `WHERE read = false` |
| `notif-settings:{tenantId}` | `notification-settings/{get,save}.js` | l | l | settings object | 1 per tenant | **YES** — already keyed by tenant; trivial to model |
| `notification-types:{id}` (`TYPE_PREFIX`) | `_lib/notification-types.js` | l | l | type config records | < 30 | **YES** — config table, but small enough that KV is also fine |
| `modify-history` | `modify-history.js`, `self-modify.js` | l | m | array of audit log entries (single blob — grows unbounded!) | hundreds-thousands over time | **YES** — append-only audit log, classic Postgres fit |
| `modify:phases` | `modify-phases.js` | l | l | object with phase median durations | 1 blob | NO — single small object, KV is fine (could move later) |

### Stays in KV (NOT migrating)

These are tiny, read-heavy, and either ephemeral or have no relational structure. Postgres adds latency and connection-pool pressure for no benefit.

| Key pattern | Why KV | Rows |
|---|---|---|
| `flags:{name}`, `flags:_index` | vh read frequency, ~38 flags total, single boolean+meta. Postgres would add latency on every API call. | ~38 |
| `gmail:info@blusbarbeque.com` | OAuth tokens — small, read on every Gmail API call, encryption-at-rest concerns easier to reason about as a single Upstash key. **DO NOT TOUCH** invariant per CLAUDE.md. | 1 |
| `gmail:tokens` | Legacy key kept for migration safety per CLAUDE.md. | 1 |
| `calendar:id`, `calendar:syncToken`, `calendar:watch`, `calendar:pendingRefresh`, `calendar:hidden`, `bbq:processed-label-id`, `bbq:archived-label-id` | Tiny operational state for Google API integration. Read-heavy, churn-low. | ~7 |
| `push:subscriptions` | Web Push subscription blob. ~10 subscriptions max in single-tenant world. (Reconsider for multi-tenant SaaS — see §6.) | < 20 |
| `settings:test_mode_email`, `settings:shop_origin_address`, `settings:guest_count_lockin_days`, `settings:digest_recipient`, `settings:lost_reasons` | Per-tenant config blobs. Small, low-churn. (For SaaS, fold into a `tenant_settings` table — see §6.) | ~5 keys |
| Future: `idempotency:*`, `ratelimit:*`, `lock:*` | Not yet in code, but if added they belong in KV (TTL native, very fast). | n/a |

### Calendar `_gcal.js` shared module
`api/calendar/_gcal.js` exports its own `kvGet`/`kvSet` and is imported by 5+ other calendar files. Treat the calendar KV state above as one block — it migrates to KV-stays.

---

## Section 2 — Target Postgres schema

JSONB-first design: store the original payload as a `payload` JSONB column to avoid premature column modeling, and pull the columns we actually query on (status, dates, customer email, etc.) up to the top level for indexing. Normalize further in subsequent PRs once query patterns stabilize.

### Conventions

- All IDs are `UUID` except where the upstream system gives us a stable string ID (Gmail thread IDs, invoice numbers — keep those as `TEXT`).
- All tables have `tenant_id UUID NOT NULL`.
- Default tenant: `00000000-0000-0000-0000-000000000001` ("blus-bbq").
- All tables have `created_at`, `updated_at TIMESTAMPTZ DEFAULT now()`. `updated_at` maintained by a trigger or by handlers explicitly.
- All tables have at minimum one `(tenant_id, ...)` composite index — `tenant_id` is always the leading column.
- Money is `NUMERIC(10,2)` (not `MONEY`, not `FLOAT`).
- `payload JSONB NOT NULL DEFAULT '{}'::jsonb` for the original blob during migration; we evolve it out over time.

### Tables

```sql
-- Tenants. Single row at first.
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,           -- 'blus-bbq'
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'blus-bbq', 'Blu''s BBQ');

-- Inquiries — the central entity.
-- Gmail threadId is the natural key (immutable, stable across UI renames).
CREATE TABLE inquiries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  thread_id       TEXT NOT NULL,                                    -- Gmail thread ID or 'qb-…' for Quote Builder
  source          TEXT NOT NULL DEFAULT 'direct',                   -- 'gmail', 'ezcater', 'direct', 'qb'
  status          TEXT NOT NULL DEFAULT 'new',                      -- pipeline status
  customer_name   TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,
  event_date      DATE,
  guest_count     INT,
  budget          NUMERIC(10,2),
  service_type    TEXT,                                             -- 'pickup' | 'delivery' | …
  quote_total     NUMERIC(10,2),
  approved        BOOLEAN NOT NULL DEFAULT false,
  has_unreviewed_update  BOOLEAN NOT NULL DEFAULT false,
  lost_at         TIMESTAMPTZ,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,               -- raw_email, extracted_fields, quote, activity_log, history
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, thread_id)
);
CREATE INDEX idx_inq_tenant_status      ON inquiries (tenant_id, status);
CREATE INDEX idx_inq_tenant_created     ON inquiries (tenant_id, created_at DESC);
CREATE INDEX idx_inq_tenant_event_date  ON inquiries (tenant_id, event_date)        WHERE event_date IS NOT NULL;
CREATE INDEX idx_inq_tenant_email       ON inquiries (tenant_id, lower(customer_email)) WHERE customer_email IS NOT NULL;
CREATE INDEX idx_inq_tenant_lost_at     ON inquiries (tenant_id, lost_at DESC)      WHERE lost_at IS NOT NULL;

-- Deposits — child of inquiries. Financial, must be auditable.
CREATE TABLE deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  inquiry_id      UUID NOT NULL REFERENCES inquiries(id) ON DELETE RESTRICT,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  paid_on         DATE NOT NULL,
  method          TEXT NOT NULL,                                    -- 'cash' | 'check' | 'card' | 'other'
  note            TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dep_tenant_inquiry ON deposits (tenant_id, inquiry_id);
CREATE INDEX idx_dep_tenant_paid_on ON deposits (tenant_id, paid_on DESC);

-- Invoices — own lifecycle, links to inquiry optionally.
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  invoice_number  TEXT NOT NULL,                                    -- human-facing number
  inquiry_id      UUID REFERENCES inquiries(id),
  customer_id     UUID,                                             -- becomes FK once customers table lands
  customer_name   TEXT,
  customer_email  TEXT,
  event_date      DATE,
  issue_date      DATE,
  due_date        DATE,
  service_type    TEXT,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
  status          TEXT NOT NULL DEFAULT 'draft',                    -- draft | sent | partial | paid | past_due | void | refunded
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,               -- line items, payment history, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);
CREATE INDEX idx_inv_tenant_status   ON invoices (tenant_id, status);
CREATE INDEX idx_inv_tenant_due      ON invoices (tenant_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_inv_tenant_inquiry  ON invoices (tenant_id, inquiry_id) WHERE inquiry_id IS NOT NULL;
CREATE INDEX idx_inv_tenant_customer ON invoices (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

-- Customer notes — row per note.
CREATE TABLE customer_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  customer_email  TEXT NOT NULL,                                    -- joined to inquiries on lower(email)
  text            TEXT NOT NULL,
  author          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_tenant_email ON customer_notes (tenant_id, lower(customer_email));

-- Customer tags — denormalized for now; revisit when customers table lands.
CREATE TABLE customer_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  customer_email  TEXT NOT NULL,
  tag             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_email, tag)
);
CREATE INDEX idx_tags_tenant_email ON customer_tags (tenant_id, lower(customer_email));

-- Notifications — replaces ZSET + per-item + counter combo.
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  severity        TEXT NOT NULL DEFAULT 'medium',
  sound           TEXT,
  icon            TEXT,
  customer_id     UUID,
  inquiry_id      UUID REFERENCES inquiries(id) ON DELETE SET NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  read            BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  dismissed       BOOLEAN NOT NULL DEFAULT false,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_tenant_created      ON notifications (tenant_id, created_at DESC);
CREATE INDEX idx_notif_tenant_unread       ON notifications (tenant_id) WHERE read = false AND dismissed = false;
CREATE INDEX idx_notif_tenant_type_created ON notifications (tenant_id, type, created_at DESC);
-- unread_count → SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND read=false AND dismissed=false;

-- Scheduled tasks (QStash dispatch state).
CREATE TABLE scheduled_tasks (
  id              TEXT PRIMARY KEY,                                 -- preserve existing taskId format
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  kind            TEXT NOT NULL,                                    -- 'email' | 'notification' | …
  scheduled_for   TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',                  -- pending | sent | cancelled | failed
  dispatched_at   TIMESTAMPTZ,
  payload         JSONB NOT NULL,                                   -- to/from/subject/body/etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_tenant_status_scheduled ON scheduled_tasks (tenant_id, status, scheduled_for);

-- Quote templates.
CREATE TABLE quote_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qtpl_tenant_name ON quote_templates (tenant_id, lower(name));

-- Chat history — row per message instead of one capped blob.
CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  role            TEXT NOT NULL,                                    -- 'user' | 'assistant' | 'system'
  content         TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_tenant_created ON chat_messages (tenant_id, created_at DESC);

-- Chat draft approval queue.
CREATE TABLE chat_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  status          TEXT NOT NULL DEFAULT 'pending',                  -- pending | approved | rejected
  draft           JSONB NOT NULL,
  decided_at      TIMESTAMPTZ,
  decided_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chatapp_tenant_status_created ON chat_approvals (tenant_id, status, created_at DESC);

-- Quote update queue (small, but relational).
CREATE TABLE quote_update_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  inquiry_id      UUID NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX idx_qupd_tenant_status_created ON quote_update_queue (tenant_id, status, created_at);

-- Modify history (AI dashboard audit log).
CREATE TABLE modify_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  actor           TEXT,
  action          TEXT NOT NULL,
  files           TEXT[],
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_modhist_tenant_created ON modify_history (tenant_id, created_at DESC);

-- Notification settings — small per-tenant config.
CREATE TABLE notification_settings (
  tenant_id       UUID PRIMARY KEY REFERENCES tenants(id),
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Future tables (out of scope, named here for design consistency)

- `customers` — currently we key by email; a real customer table with FK from inquiries/invoices is the next normalization step.
- `tenant_settings` — for the items currently in `settings:*` KV keys (test_mode_email, shop_origin_address, lost_reasons, digest_recipient, guest_count_lockin_days). Small enough to leave in KV today; trivial to fold in once SaaS lands.

### Row Level Security (RLS) — design intent, not enabled in v1

Schema is RLS-ready (every table carries `tenant_id`). For v1, isolation is enforced at the **app layer** by a `withTenant(tenantId)` query helper — every query in the data layer goes through it and refuses to compose SQL without `tenant_id` in the WHERE clause. This is faster to implement and easier to debug than session-variable RLS during the migration. We can flip to true RLS (`CREATE POLICY … USING (tenant_id = current_setting('app.tenant_id')::uuid)`) at SaaS launch without changing the schema.

---

## Section 3 — Migration sequence (smallest blast radius first)

Each step is one focused PR. Each PR ships Phase A (dual-write, KV-read) — the next PR for the same scope ships Phase B+C (backfill + Postgres-read flag flip). Effort is for the full A→D cycle of that step.

| # | Scope | Effort | Read-cutover flag | Why this position |
|---|---|---|---|---|
| 1 | **Notifications** (`notifications:list` + `notifications:item:*` + `notifications:unread_count`) | S–M | `pg_reads_notifications` | Self-contained module (`api/_lib/notifications.js`), already abstracted. Simple shape. Validates the dual-write pattern with low risk. |
| 2 | **Deposits** (`deposits:{threadId}`) | S | `pg_reads_deposits` | Small, well-bounded, financial — we want auditing + FK to inquiry from day 1. |
| 3 | **Quote templates** (`templates:quotes:*`) and **chat approvals** (`chat:approval:queue`) | S | `pg_reads_quote_templates`, `pg_reads_chat_approvals` | Tiny data, low write volume, lets us shake out the dual-write helper on more handlers before tackling big stuff. Can be one PR or two — recommend two for cleaner rollback. |
| 4 | **Modify history** (`modify-history`) | S | `pg_reads_modify_history` | Append-only audit log. KV blob currently grows unbounded — Postgres fixes this and unblocks better history UI. Low blast radius (it's an internal audit). |
| 5 | **Scheduled tasks** (`task:{taskId}`) | M | `pg_reads_scheduled_tasks` | Touches `dispatch/email.js` which is on the **DO NOT TOUCH** list. We migrate the *task storage* (read/write) only — the Gmail send path stays unchanged and uses the new tasks data layer. Requires extra-careful review. |
| 6 | **Chat history** (`chat:history`) | S | `pg_reads_chat_history` | High write volume but trivial schema. After step 5 the dual-write pattern is well-trodden. |
| 7 | **Quotes** (data lives inside `inquiries:{threadId}.quote`) | M | `pg_reads_quote_payload` (or fold into step 9) | If we want a separate `quotes` table later, do it as a normalization PR after inquiries land. For v1, leave it inside `inquiries.payload` and skip a dedicated step — note in §8. |
| 8 | **Customer notes & tags** (`customer:{email}:notes`, `customer:{email}:tags`) | S | `pg_reads_customer_notes` | Standalone, small. Slot it whenever convenient — recommend before inquiries to validate email-based lookups. |
| 9 | **Inquiries** (`inquiries:index` + `inquiries:{threadId}`) | L | `pg_reads_inquiries`, `pg_reads_inquiries_index` | The big one. Touched by ~25 handlers. Last because every prior step has hardened the pattern. The `inquiries:index` blob is the hottest write path on the system; replacing it with a real query removes the biggest source of KV traffic. |
| — | **Invoices** (`invoice:{id}`, `invoices:index`) | M | `pg_reads_invoices` | Decision: invoice manager is gated by `invoice_manager_v1` flag and has lower traffic than inquiries. Slot it between #4 and #5 if you want financial data on Postgres early; otherwise after #9. Recommend **early** (between #2 and #3) since it's small and the financial-audit story matters. |

**Effort recap:** S = ~0.5–1 day, M = ~1–2 days, L = ~2 days. See §7 for total.

---

## Section 4 — Dual-write pattern

### The shared abstraction (built in step 0, before step 1)

Before any migration step, land **one** PR introducing `api/_lib/db.js` (Postgres pool + helpers) and refactoring `api/_lib/kv.js` to be the single shared kvGet/kvSet (today every handler inlines its own copy — that has to die). The dual-write logic for each entity lives in a small per-entity data-access module:

```
api/_lib/data/
  inquiries.js       // exports: getInquiry, listInquiries, saveInquiry, ...
  deposits.js
  notifications.js
  invoices.js
  ...
```

Each module is the *only* place that reads or writes its data — handlers stop calling kvGet/kvSet directly. This is what unlocks dual-write without touching every handler.

```js
// api/_lib/data/notifications.js — sketch
const { kvGet, kvSet } = require('../kv.js');
const { withTenant } = require('../db.js');
const { getFlag } = require('../flags.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

async function createNotification(input) {
  // Phase A: dual-write
  const record = buildRecord(input);
  await kvSet('notifications:item:' + record.id, JSON.stringify(record));   // KV (source of truth in A)
  try {
    await withTenant(TENANT).insert('notifications', record);                // Postgres (best-effort in A)
  } catch (e) {
    console.error('[dual-write] notifications PG insert failed', { id: record.id, err: e.message });
    // Do not throw — KV write succeeded.
  }
  return record;
}

async function listNotifications(opts) {
  // Phase C: read flag controls source.
  if (await getFlag('pg_reads_notifications')) {
    return withTenant(TENANT).listNotifications(opts);                      // Postgres
  }
  return listFromKV(opts);                                                   // KV (existing path)
}
```

### Phases per scope

| Phase | What | Source of truth | Cutover gate |
|---|---|---|---|
| **A — dual-write, KV-read** | Every write goes to both KV and Postgres. Reads still come from KV. PG write failure logs loudly but does not error the request. | KV | Deploy + bake ≥ 24h. Watch logs for `[dual-write] … failed` lines. |
| **B — backfill** | One-time idempotent script reads all KV records and `INSERT … ON CONFLICT DO UPDATE`s into Postgres. Quota-bounded — must run after Upstash daily reset OR on a paid tier. | KV | Verify `SELECT count(*)` matches KV cardinality. |
| **C — Postgres-read behind flag** | Reads come from Postgres when `pg_reads_<scope>` is ON. Writes still go to both. | KV (writes) + PG (reads, when flag on) | Bake ≥ 48h with flag ON. Compare `pg_reads_<scope>` counts to error rates. |
| **D — KV-write removal** | Stop writing to KV. Keep one release cycle of `dual_write_<scope>` flag for emergency fallback. Delete the KV namespace after one week clean. | PG | Final. Drop the flag in a follow-up PR. |

### Atomic cross-key writes

Today, several handlers write multiple KV keys without any atomicity (e.g. `inquiries/save.js` writes both `inquiries:{threadId}` and `inquiries:index` — a crash between them desyncs the index). Postgres fixes this by wrapping the handler in a single transaction:

```js
await withTenant(TENANT).transaction(async (tx) => {
  await tx.upsert('inquiries', record);
  // No separate index update — query replaces the index blob entirely.
});
```

This isn't a feature we have to add; it's a **bug class that goes away** when we cut over.

---

## Section 5 — Rollback story

Per phase, what's the path back?

| Phase | Failure mode | Rollback |
|---|---|---|
| **A** | PG inserts failing in production | Revert the dual-write commit. KV is unchanged — the system is exactly as it was before. No data loss, no user impact. |
| **B** | Backfill script bug (corrupt rows, wrong tenant_id) | Backfill is idempotent (`ON CONFLICT DO UPDATE` keyed by natural key + `tenant_id`). Safe to rerun. Worst case: `TRUNCATE` the table and rerun from KV. KV is still source of truth — no harm. |
| **C** | Postgres reads return wrong/stale data | Flip `pg_reads_<scope>` flag OFF — reads return to KV instantly. Postgres has stale data but no harm done. Investigate, fix, backfill again, re-flip. |
| **D** | Discovered a regression after KV writes were removed | Re-enable KV writes (the `dual_write_<scope>` flag stays in code for one release cycle for exactly this reason). Backfill any KV records lost during the gap from Postgres (reverse direction). After confirming clean, re-attempt D. |

**Hard guarantee:** until Phase D ships AND the dual-write flag is removed, KV is always available as a source of truth. There is no point in the migration where reverting a single PR cannot restore the system.

---

## Section 6 — Risks & open questions

### Confirmed risks

1. **Vercel serverless connection limits.** Each invocation can open a connection — without pooling, we'll exhaust the Postgres connection cap fast. **Mitigation:** use Vercel Postgres's built-in pgbouncer connection (the `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` distinction). Default to pooled URL for handlers, non-pooled only for migration scripts.
2. **Atomic multi-key writes.** Today `inquiries/save.js` and `cron/mark-completed.js` both write `inquiries:{threadId}` and `inquiries:index` non-atomically. The migration *fixes* this by using a single transaction — but during Phase A we still have the old non-atomic KV path. Acceptable risk; the bug already exists.
3. **Webhook retries.** QStash retries dispatch on failure. The current `dispatch/email.js` checks `task:{taskId}.dispatched` to avoid double-send. **Confirm:** during the scheduled-tasks migration step (#5), the dispatched-flag read must come from whichever source is currently authoritative (controlled by `pg_reads_scheduled_tasks`), and the dual-write must update the dispatched flag in BOTH stores or we risk double-sends when the flag flips. Special handling required.
4. **Search.** Postgres gives us LIKE/ILIKE/`pg_trgm`/full-text. Today the codebase has no LIKE-style emulation — every "search" iterates the `inquiries:index` blob in JS (e.g. `inquiries/by-email.js`). Postgres trivially replaces these; document the wins per handler when migrating.
5. **`push:subscriptions` is a single blob.** Stays in KV per §1, but for SaaS multi-tenant it becomes "all tenants' subscriptions in one blob" which is wrong. Add a follow-up to model push subscriptions properly before SaaS launch — out of scope for this migration.

### Open questions for review

1. **Does Vercel Postgres exist on this project today?** No code, env vars, or scripts reference it (`grep -rn POSTGRES api/ static/ scripts/ package.json` returns zero). The task brief says "already provisioned via Vercel" — please confirm the env vars (`POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, etc.) are available in the Vercel project so step 0 can wire them up.
2. **Driver choice:** Vercel ships `@vercel/postgres` (built on `@neondatabase/serverless`, edge-compatible). Recommend that over raw `pg` — it handles pooling and works in Vercel's serverless runtime out of the box. No ORM in v1 — we write thin SQL in `api/_lib/data/*` modules. Alternatives (Drizzle, Kysely) are a separate decision; `@vercel/postgres`'s tagged-template `sql\`\`` works fine for our query patterns.
3. **Migration tool:** Recommend `node-pg-migrate` (small, plain-SQL migrations, no ORM dependency) running via `npm run migrate:up` against the Vercel Postgres URL. Alternatively a hand-rolled `scripts/migrations/NNNN-*.sql` runner — fine for a project this size.
4. **Tenant ID coordination:** the default `00000000-0000-0000-0000-000000000001` is internal only — does NOT need to match any auth/email/Stripe identifier today. When SaaS lands, real tenant IDs are minted on signup. Confirm no cross-system implication.
5. **`gmail:info@blusbarbeque.com` lockdown.** The Gmail OAuth tokens stay in KV (§1). For multi-tenant SaaS, each tenant gets their own `gmail:{tenantId}:tokens` key — but that's a SaaS-launch concern, not a migration concern. The `dispatch/email.js` invariant is preserved: it never moves to Postgres.

---

## Section 7 — Effort estimate

Best-case timeline. Each "day" = one focused engineering day with verification + bake time before moving on.

| Step | Scope | Effort |
|---|---|---|
| 0 | Step 0: shared `db.js` + `kv.js` + per-entity `data/*` skeleton + first migration runner | **1 day** |
| 1 | Notifications (validates pattern) | 1 day |
| 2 | Deposits | 1 day |
| 3 | Quote templates + chat approvals | 1 day |
| 4 | Modify history | 0.5 day |
| 4b | Invoices (slotted early per §3 footnote) | 1.5 days |
| 5 | Scheduled tasks (touches DO-NOT-TOUCH-adjacent code) | 2 days |
| 6 | Chat history | 0.5 day |
| 7 | Customer notes + tags | 0.5 day |
| 8 | Inquiries (the big one) | 2 days |
| 9 | Phase D cleanup + KV namespace deletion + dual-write code removal | 1 day |
| **Total** | | **~12 working days** |

(Original prompt estimated ~8 days for the migrations themselves. Adding step 0 and a Phase D cleanup pass per scope, plus invoices, lands at ~12 days. Could be compressed if we skip the per-step bake time, but bake time is what makes rollback possible.)

---

## Section 8 — Open recommendations

1. **Should we upgrade Upstash to Pay-as-You-Go for the backfill window?** Recommend **yes** — $10 for one month buys headroom for backfill scripts that read every key in a namespace without burning prod's daily quota. Cancel after migration. Alternative is running each backfill at 00:01 UTC immediately after the daily reset, which is fragile.
2. **Backfill timing:** if we don't pay for headroom, run each backfill in a single window during low-traffic hours. The biggest one (inquiries: ~500 reads + 500 writes = 1K commands) is a non-event; the small ones are noise. Pay-as-you-go is mostly insurance against re-running on bugs.
3. **Did we miss any KV namespaces?** Possibly — please scan §1 against your mental model. Specifically verify: `customer:{email}:tags` (only used in `customers/tags.js`), `quote_updates:queue` (used by `_lib/quote-update-queue.js`, may have child keys per item that I treated as part of the same namespace), and `notification-types:{id}` (small; could stay in KV — flagged as YES today but it's a judgment call).
4. **Tenant ID default** `00000000-0000-0000-0000-000000000001` — not coordinated with any external system today (no auth/email/Stripe coupling). For SaaS launch, real tenants will be UUIDs minted on signup — the default tenant becomes the legacy "Blu's BBQ" record. No action needed now.
5. **Quotes as their own table?** §3 step 7 leaves quotes inside `inquiries.payload`. If you want a dedicated `quotes` table (separate version history, multiple drafts per inquiry, template provenance), say so — that's a different schema and a different migration step. v1 keeps it in JSONB for speed.
6. **Quote builder threadId format** (`qb-{ts}-{rand}`) is non-Gmail. The schema accepts it as `thread_id TEXT` — no special handling needed, but the convention is documented here so it doesn't surprise the next reviewer.
7. **Recommend a "shadow read" diff job** for one bake cycle on inquiries (step 8). Read both KV and Postgres for every request, compare in a fire-and-forget log line. Catches subtle field-shape regressions that flag-cutover tests would miss. Adds ~20 lines to `data/inquiries.js`; remove after Phase D.

---

## Appendix — File-by-file impact for step 0

The shared abstraction PR touches every handler that inlines its own `kvGet`/`kvSet`. Inventory (count of `function kvGet` definitions in `api/`):

```
api/_lib/{flags,notifications,notification-types,quote-update-queue,post-event-archive,
         repeat-customer,settings,shop-origin,guest-count-lockin}.js
api/auth/{callback,status}.js
api/calendar/_gcal.js  (+ all its importers consume from here, no change needed)
api/chat/{approval,history}.js
api/cron/{mark-completed,poll-inquiries,renew-calendar-watch,weekly-digest}.js
api/customer/{notes,profile}.js
api/customers/tags.js
api/deposits/{list,save}.js
api/diag/verify-sender.js
api/dispatch/email.js                         ← DO NOT TOUCH list — leave its inline helpers alone
api/events/today.js
api/gmail/list-inquiries.js
api/inquiries/{acknowledge,approve,archive,by-email,completed,draft-email,get,list,
              process-followup,save,send-now,test,thread}.js
api/invoices/_lib.js                          (already a shared lib — easiest target)
api/modify-history.js
api/modify-phases.js
api/notification-settings/{get,save}.js
api/notifications/{cadence-tick,send,subscribe}.js
api/orders/mark-lost.js
api/pipeline/{alerts,overdue}.js
api/quotes/{duplicate,templates}.js
api/schedule.js
api/self-modify.js                            ← DO NOT TOUCH list — leave its inline helpers alone
api/settings/{lost-reasons,digest-recipient}.js
api/tasks.js
api/ai/{add-details,quote-update-scan,regenerate,thank-you-draft}.js
```

That's ~50 files. The refactor is purely mechanical — replace the inlined helpers with `const { kvGet, kvSet } = require('./_lib/kv.js')` — and shippable as one PR. The two **DO NOT TOUCH** files (`dispatch/email.js`, `self-modify.js`) keep their inlined helpers; they're explicitly pinned by CLAUDE.md and they're not on the migration path anyway (Gmail tokens and `modify-history` blob remain — modify-history will get its own data-module, but `self-modify.js` itself doesn't need refactoring to use it, since it can keep talking to a small `data/modify-history.js` wrapper).
