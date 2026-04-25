/* ===== FLAGS HELPER
   KV-backed feature flag store.
   Key pattern: flags:{name}  → JSON { enabled, description, created_at }
   Index key:   flags:_index  → JSON string[] of flag names

   Exports: getFlag, setFlag, listFlags
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// Seed flags — these appear in listFlags() even if never written to KV.
// Enabling a flag for the first time writes it to KV.
const SEED_FLAGS = [
  { name: 'kanban_restructure',     description: 'Restructured kanban board layout' },
  { name: 'notifications_center',   description: 'Unified notifications center panel' },
  { name: 'ai_quote_updates',       description: 'AI-generated quote revision suggestions (scan + queue)' },
  { name: 'test_customer_mode',     description: 'Test customer mode — create fake inquiries for QA' },
  { name: 'sms_channel',            description: 'SMS outreach channel (Twilio)' },
  { name: 'deposit_tracking',       description: 'Deposit tracking panel on inquiry cards' },
  { name: 'ai_dessert_trigger',     description: 'Auto-notify Zach to offer dessert when customer replies to a sent quote' },
  { name: 'ai_post_event_archive',  description: 'Daily auto-archive of non-booked past-event inquiries with hope-to-serve draft' },
  { name: 'nav_v2',                 description: 'Nav v2 — bottom tab bar (mobile) + collapsed sidebar (tablet/desktop); replaces hamburger', default: true },
  { name: 'ezcater_integration',    description: 'Show ezCater source filter chip — enable once ezCater account is connected and sending leads' },
  { name: 'event_day_view',         description: 'Today tab — field-ops event-day view (Group 10)' },
  // Group 4 — Completed Orders Handling
  { name: 'completed_orders_view',  description: 'Completed Orders tab in Inquiries — period totals + revenue table (OFF on merge, Zach flips)' },
  { name: 'completed_eom_hide',     description: 'Kanban: DISABLE EOM hide on Completed column (EOM hide is default-on; enable flag to show all months)' },
  // Group 8 — Calendar enhancements (default OFF)
  { name: 'calendar_v2',            description: 'Calendar v2: status color-coding, monthly totals dropdown, period selector chips' },
  // Group 7 — Quote Builder extensions (default OFF)
  { name: 'quote_builder_v2',       description: 'Quote Builder v2: Save as Draft, Load Draft, auto-save (localStorage)' },
  // Group 9 — Customer Profile + Widgets (default OFF)
  { name: 'customer_profile_v2',    description: 'Customer profile page: stats widgets, inquiry history, notes — drill-down from inquiry detail' },
  // Group 9 extended — overdue widget, quote templates, weekly digest (default OFF)
  { name: 'overdue_widget',         description: 'Dashboard widget: unanswered quotes, overdue deposits, events missing headcount' },
  { name: 'weekly_digest',          description: 'Monday 8 AM digest email: week events, outstanding quotes, overdue follow-ups' },
  { name: 'quote_templates',        description: 'Quote template library — save/load canned setups in Quote Builder' },
  // Wave 0.5 — iOS polish
  { name: 'ios_polish_v1',          description: 'Wave 0.5 iOS polish — bottom-sheet confirms, pull-to-refresh, iOS toggles, safe-area fixes', default: true },
  // Wave 1 — Core UX
  { name: 'todays_actions_widget',  description: "Wave 1: Today's Actions card on dashboard home — overdue follow-ups, today's events, AI draft reviews, pending approvals", default: true },
  { name: 'customer_tags',          description: 'Wave 1: Customer tag picker on profiles + tag chips on inquiry cards (VIP, Corporate, etc.)', default: true },
  { name: 'lost_reason_capture',    description: 'Wave 1: BottomSheet for lost-reason when moving card to Lost; user-editable reasons in Settings', default: true },
  // Customer nav
  { name: 'customers_nav_v1',       description: 'Top-level Customers nav item in sidebar — links to customer profile page (default OFF; Zach flips when ready)' },
  // Sales Panel + Invoice Manager
  { name: 'sales_panel_v1',         description: 'Pipeline page: replace count tiles with financial sales summary panel (Past Due / Unpaid / Charges / Paid) with time-range toggle' },
  { name: 'invoice_manager_v1',     description: 'Invoice Manager: create, track, and record payments on invoices — manual flow only (default OFF)' },
  // Kanban + list overhaul (Wave 2)
  { name: 'kanban_edit_mode_v1',    description: 'Kanban: long-press column to enter edit mode — reorder, rename, add, delete columns; persisted to KV' },
  { name: 'lost_auto_hide_48h',     description: 'Kanban + list: auto-hide Lost entries 48h after losing; display filter only, data not deleted' },
  // Date picker + calendar filters
  { name: 'date_picker_v2',         description: 'Unified date-range picker on kanban, list view, and inquiries page — replaces legacy chip filters' },
  { name: 'calendar_filters_v2',    description: 'Calendar page: replace period chips with status filter chips (Booked/Completed default ON)' },
  // Wave 3 — AI approval actions
  { name: 'ai_approval_actions_v1', description: 'AI approval: Regenerate + Add Details inline actions on draft approval cards (default OFF)' },
];

async function getFlag(name, defaultValue) {
  const seed = SEED_FLAGS.find(f => f.name === name);
  const seedDefault = seed && seed.default === true ? true : false;
  const def = defaultValue !== undefined ? defaultValue : seedDefault;
  try {
    const raw = await kvGet('flags:' + name);
    if (!raw) return def;
    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof rec.enabled === 'boolean' ? rec.enabled : def;
  } catch {
    return def;
  }
}

async function setFlag(name, enabled, description = '') {
  const existing = await getRecord(name);
  const rec = {
    enabled: !!enabled,
    description: description || (existing && existing.description) || '',
    created_at: (existing && existing.created_at) || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await kvSet('flags:' + name, rec);

  // Update index
  const rawIdx = await kvGet('flags:_index');
  let index = [];
  try { index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { index = []; }
  if (!Array.isArray(index)) index = [];
  if (!index.includes(name)) index.push(name);
  await kvSet('flags:_index', index);

  return rec;
}

async function getRecord(name) {
  try {
    const raw = await kvGet('flags:' + name);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return null; }
}

async function listFlags() {
  // Read KV index
  const rawIdx = await kvGet('flags:_index').catch(() => null);
  let kvNames = [];
  try { kvNames = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : []; } catch { kvNames = []; }
  if (!Array.isArray(kvNames)) kvNames = [];

  // Union of seed names + any KV-only names (e.g. dynamically created)
  const seedNames = SEED_FLAGS.map(f => f.name);
  const allNames  = Array.from(new Set([...seedNames, ...kvNames]));

  const results = await Promise.all(allNames.map(async name => {
    const raw = await kvGet('flags:' + name).catch(() => null);
    let rec = null;
    try { rec = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null; } catch { rec = null; }

    const seed = SEED_FLAGS.find(f => f.name === name);
    const seedDefault = seed && seed.default === true ? true : false;
    return {
      name,
      enabled:     rec ? !!rec.enabled : seedDefault,
      description: (rec && rec.description) || (seed && seed.description) || '',
      created_at:  (rec && rec.created_at) || null,
    };
  }));

  return results;
}

module.exports = { getFlag, setFlag, listFlags, SEED_FLAGS };
