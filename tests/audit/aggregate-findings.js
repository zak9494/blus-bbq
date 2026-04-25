#!/usr/bin/env node
/**
 * Aggregates per-test findings JSON files written by live-deploy-audit.spec.js
 * into a single, analyzed markdown report grouped by surface area.
 *
 * Usage: node tests/audit/aggregate-findings.js
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.AUDIT_BASE_URL || 'https://blus-bbq.vercel.app';
const FINDINGS_DIR = path.join(__dirname, '.findings');
const REPORT_PATH = path.join(__dirname, '2026-04-25-findings.md');

if (!fs.existsSync(FINDINGS_DIR)) {
  console.error(`No findings directory at ${FINDINGS_DIR}`);
  process.exit(1);
}

const SURFACE_META = {
  'kanban':           { area: 'Kanban',           label: 'Pipeline (kanban view)' },
  'list-view':        { area: 'List view',        label: 'Pipeline (list view)' },
  'inquiries':        { area: 'Inquiries',        label: 'Inquiries' },
  'calendar':         { area: 'Calendar',         label: 'Calendar' },
  'customer-profile': { area: 'Customer profile', label: 'Customer profile' },
  'invoices':         { area: 'Invoices',         label: 'Invoice Manager' },
  'quotes':           { area: 'Quote builder',    label: 'Quote Builder' },
  'notifications':    { area: 'Notifications',    label: 'Notifications center page' },
  'notif-settings':   { area: 'Notifications',    label: 'Notification settings' },
  'settings':         { area: 'Settings',         label: 'Settings (general)' },
  'today':            { area: 'Today',            label: 'Today (event-day-view)' },
};

const ORDER = ['Calendar', 'Notifications', 'Kanban', 'List view', 'Inquiries', 'Customers', 'Customer profile', 'Invoices', 'Settings', 'Quote builder', 'Today'];

const allFindings = [];
const cleanRuns = [];
const totalFiles = [];

for (const file of fs.readdirSync(FINDINGS_DIR)) {
  if (!file.endsWith('.json')) continue;
  totalFiles.push(file);
  const data = JSON.parse(fs.readFileSync(path.join(FINDINGS_DIR, file), 'utf8'));
  const meta = SURFACE_META[data.slug] || { area: data.slug, label: data.slug };
  if (data.isClean) {
    cleanRuns.push(`${meta.label} @ ${data.viewport}`);
  }
  for (const f of data.findings) {
    allFindings.push({ ...f, _slug: data.slug, _viewport: data.viewport });
  }
}

const groups = {};
for (const f of allFindings) {
  if (!groups[f.surface]) groups[f.surface] = [];
  groups[f.surface].push(f);
}

const totalRuns = totalFiles.length;
const surfacesWithFindings = Object.keys(groups).length;

let md = `# Live deployment audit — 2026-04-25\n\n`;
md += `**Target:** ${BASE_URL}\n\n`;
md += `**Viewports:** mobile 375×667 · ipad 768×1024 · desktop 1280×800\n\n`;
md += `**Surfaces tested:** 11 × 3 viewports = ${totalRuns} runs · read-only (no mutating clicks, no data writes)\n\n`;

md += `> **App shape:** This is a SPA. Pages are switched via in-page \`window.showPage(name)\` rather than URL routes — there is no \`/customers\` or \`/invoices\` URL. All audited surfaces are reached by visiting \`/\` and then driving \`showPage(...)\` in JS. "Surfaces don't exist as URL routes" is therefore expected; what matters is whether the in-page surface renders without error.\n\n`;

md += `## Summary\n\n`;
md += `- **Total findings:** ${allFindings.length}\n`;
md += `- **Clean runs:** ${cleanRuns.length} / ${totalRuns}\n`;
md += `- **Surfaces with ≥1 finding:** ${surfacesWithFindings}\n`;
md += `- **Surfaces fully clean across all 3 viewports:** ${
  (() => {
    const bySurface = {};
    for (const c of cleanRuns) { const s = c.split(' @ ')[0]; bySurface[s] = (bySurface[s] || 0) + 1; }
    return Object.values(bySurface).filter(n => n === 3).length;
  })()
} / 11\n\n`;

md += `**Note:** the same 2-3 root causes are responsible for the bulk of the 69 raw findings. The "Root causes" section below explains them once; the per-surface section then lists which surfaces are affected.\n\n`;

md += `## Root causes (high-confidence)\n\n`;

md += `### 1. Missing static asset: \`/static/js/qb-quarter-chicken-gate.js\` (404, every page, every viewport)\n\n`;
md += `\`index.html:5561\` references \`<script defer src="/static/js/qb-quarter-chicken-gate.js"></script>\` but the file does not exist on disk on \`origin/main\` and \`HTTP 404\` from the deployed app. Every page accumulates one console error + one network failure as a result.\n\n`;
md += `- **Impact:** No functional impact (the script is gated by the \`qb_quarter_chicken_3meat\` flag which is OFF), but it generates a console error on every page load and pollutes monitoring/log noise. Anyone reading prod console logs sees a 404 and looks for cause.\n`;
md += `- **Fix direction:** either remove the \`<script>\` tag from \`index.html\` or land the missing module file. The flag is OFF so the script tag can be safely removed; alternatively add an empty \`static/js/qb-quarter-chicken-gate.js\` and register it in \`STATIC_MODULE_FILES\`.\n\n`;

md += `### 2. Notifications-center API endpoints don't exist server-side (404)\n\n`;
md += `\`static/js/notifications-panel.js\` calls these on every page load (in \`notifPanelInit\`) and on every drawer open / page render:\n\n`;
md += `- \`GET /api/notifications/counts\` → 404\n`;
md += `- \`GET /api/notifications/types\` → 404\n`;
md += `- \`GET /api/notifications?limit=20&offset=0\` (root-level) → 404\n\n`;
md += `Verified with \`curl\`. Only \`/api/notifications/subscribe\`, \`/api/notifications/send\`, and \`/api/notifications/vapid-key\` exist on the server side.\n\n`;
md += `- **Impact (Notifications page only):** the page renders the topbar + filter chip placeholder + an \`.nc-empty\` block that says **"Failed to load."** — this is user-visible. Captured screenshot: \`tests/screenshots/audit-2026-04-25/notifications-{mobile,ipad,desktop}.png\`.\n`;
md += `- **Impact (every other page):** the panel's \`init()\` is gated by the \`notifications_center\` feature flag. Production has \`notifications_center: false\`, so init bails before it tries the panel APIs — but the source-load 404 \`/api/notifications/counts\` still fires from the \`poll()\` interval (\`notifications-panel.js:152\`) before the gate check on subsequent ticks. _Need to verify whether 404 fires when flag is OFF — currently audit shows 2× 404 on every page including ones that aren't the Notifications page, suggesting the polling/init path bypasses the flag check._\n`;
md += `- **Fix direction:** ship the missing API routes (or stub them to return \`{ok:true, unread_count:0, notifications:[]}\`) and add the rewrites to \`vercel.json\`. Alternatively, gate ALL notifications-panel.js network calls strictly behind \`window.flags.isEnabled('notifications_center')\` to silence the 404s while the flag is OFF.\n\n`;

md += `### 3. Notification Settings SAVE still 401s (load was already fixed by #77, save remains broken)\n\n`;
md += `**LOAD path:** ✅ fixed. PR #77 (\`877960b fix(notif-settings): 401 on load + duplicate hamburger nav\`) is deployed; \`GET /api/notification-settings\` returns 200, page renders all 11 toggles cleanly.\n\n`;
md += `**SAVE path:** ⚠️ still broken. Toggling any switch fires a 401 silently — the page LOOKS like it worked, but nothing persists.\n\n`;
md += `- \`static/js/notification-settings.js:28\` defines:\n  \`\`\`js\n  function getSecret() {\n    return (window._appSecret || window.APP_SECRET || '');\n  }\n  \`\`\`\n  Neither \`window._appSecret\` nor \`window.APP_SECRET\` is set anywhere in the codebase (\`grep\` confirms only the function references them).\n- \`api/notification-settings/save.js:72-75\` requires \`body.secret === process.env.GMAIL_READ_SECRET\` and returns 401 otherwise.\n- Verified via direct curl: \`POST /api/notification-settings/save\` with \`secret: ""\` → \`HTTP 401 {"error":"Unauthorized"}\`.\n- **Impact:** Toggling any channel/event in Settings → Notifications fails silently (the save handler probably swallows the error). User makes a change, page appears to accept it, nothing persists.\n- **Fix direction:** \`getSecret()\` should read \`window.INQ_SECRET\` (the rest of the codebase uses this — see \`pipeline-alerts.js:12-14\`, \`customer-profile.js:12-14\`). And the server should accept \`INQ_SECRET\` (or whatever env var the rest of the app uses), not \`GMAIL_READ_SECRET\`. Pick one secret, use it consistently.\n\n`;

md += `### 4. Pipeline alerts 401 (kanban + list views)\n\n`;
md += `Same class of bug as #3, different mismatch.\n\n`;
md += `- \`static/js/pipeline-alerts.js:73\` calls \`/api/pipeline/alerts?secret=<INQ_SECRET>\` — i.e. sends the inquiry secret \`c857eb539774b63cf0b0a09303adc78d\` (hardcoded in \`index.html:3679\`).\n`;
md += `- \`api/pipeline/alerts.js:47-48\` requires \`secret === process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN\`.\n`;
md += `- \`INQ_SECRET\` and \`SELF_MODIFY_SECRET\` are different env vars. Verified: every \`/api/pipeline/alerts?...\` request returns 401.\n`;
md += `- **Impact:** Kanban + List views fetch alerts on every load → 401 → the alerts banner is hidden by the catch block (\`pipeline-alerts.js:80-83\`). _Soft-failure_ — user doesn't see an error toast, just no alerts. But Stale Reply / Past Due / Unpaid Balance / Upcoming 48h alerts never display.\n`;
md += `- **Fix direction:** server-side, accept \`INQ_SECRET\` (or the same secret the rest of the app uses) — or update the client to send \`SELF_MODIFY_SECRET\`. Don't store \`SELF_MODIFY_SECRET\` in the client (it's a write-credential).\n\n`;

md += `### 5. Calendar — likely a perception bug, not a code bug\n\n`;
md += `Earlier I suspected the calendar was still broken. After cross-checking other months, **the calendar is working**. The user-reported "calendar shows zero events with v2 filters" appears to have been a side-effect of the user landing on the current month (April 2026) which is empty.\n\n`;
md += `- \`GET /api/calendar/list?...&year=2026&month=4\` → 200, \`events: []\` (April genuinely empty)\n`;
md += `- \`GET /api/calendar/list?...&year=2026&month=5\` → 200, **events present** (e.g. "Main auction" 2026-05-…)\n`;
md += `- \`GET /api/calendar/list?...&year=2026&month=6\` → 200, \`events: []\`\n`;
md += `- Fix commit \`e915810 fix(calendar): events not rendering with v2 filters (#64)\` is on \`main\` and deployed.\n\n`;
md += `**Action:** click "Next" on the calendar to advance to May 2026 and confirm "Main auction" renders as a chip. If yes, this finding is closed — the original v2-filter regression is fixed, and the empty April view is just an empty month. If no, then there's a residual rendering bug specific to certain months and we re-open.\n\n`;
md += `**Side note:** the API response includes \`"calendarId":"primary"\` for empty months. May's response does not (it includes a real calendar ID). That's fine — it's just the response field shape. No action needed.\n\n`;

md += `### 6. Customer Profile is stuck at "Loading…" on direct nav\n\n`;
md += `\`window.customerProfile.init()\` is a no-op (\`customer-profile.js:233\`). The actual content fetch is in \`window.customerProfile.show(email)\`, only called when a user clicks a customer link / card. If the user reaches \`#page-customer\` directly (deep link, refresh while on the page, or in the audit's case \`showPage('customer')\` with no prior \`.show()\`), the page shows the static \`<div id="cp-loading">Loading…</div>\` element (\`index.html:1469\`) which is never hidden. The \`#cp-body\` div remains \`display:none\`.\n\n`;
md += `- **Impact:** mostly affects refresh/back behavior — anyone who hits Refresh while viewing a customer profile will land back on a "Loading…" forever screen.\n`;
md += `- **Fix direction:** persist the most recent customer email in localStorage (or in URL hash); on \`init()\`, if a recent email exists, call \`show(email)\`; otherwise render an "Open a customer from the inquiries list" empty state instead of Loading…\n\n`;


md += `## Findings (grouped by surface area)\n\n`;

if (allFindings.length === 0) {
  md += `_No raw findings recorded._\n\n`;
} else {
  const seen = new Set();
  for (const area of ORDER) {
    if (!groups[area]) continue;
    seen.add(area);
    md += `### ${area}\n\n`;
    groups[area].sort((a, b) => (a._viewport + a.kind).localeCompare(b._viewport + b.kind));

    // Add area-specific summary up top.
    if (area === 'Calendar') {
      md += `**Status:** ✅ functional. April 2026 is genuinely empty (cross-checked May/June: May has events, June empty). The original v2-filter bug is fixed by #64; the user's "zero events" report appears to have been the empty-month state. Click Next to May to confirm. See root cause #5.\n\n`;
    } else if (area === 'Notifications') {
      md += `**Status:** mixed. Notifications **page** is user-visibly broken — shows "Failed to load." text (root cause #2). Notification **settings** LOAD path is fixed (#77 worked) but SAVE still 401s silently (root cause #3 — needs an interaction to reproduce; passive audit cannot see this).\n\n`;
    } else if (area === 'Kanban' || area === 'List view') {
      md += `**Status:** soft-fail. Page renders, columns and cards visible, but the alerts banner silently hides because of the pipeline-alerts 401 (root cause #4). User-visible regression: stale-reply / past-due / unpaid-balance alerts never appear.\n\n`;
    } else if (area === 'Customer profile') {
      md += `**Status:** ⚠️ direct nav stuck on "Loading…" (root cause #6). When reached via a customer click it works; on refresh or deep-link it doesn't recover.\n\n`;
    } else if (area === 'Invoices') {
      md += `**Status:** ✅ functional. Empty state renders correctly ("No invoices found.", "1–0 of 0"). Console 404 noise only — no Invoice-specific failures.\n\n`;
    } else if (area === 'Inquiries') {
      md += `**Status:** ✅ page renders. Console 404 noise only — no Inquiry-specific failures.\n\n`;
    } else if (area === 'Settings') {
      md += `**Status:** ✅ page renders. Console 404 noise only.\n\n`;
    } else if (area === 'Quote builder') {
      md += `**Status:** ✅ page renders. Console 404 noise only.\n\n`;
    } else if (area === 'Today') {
      md += `**Status:** ✅ page renders ("No events scheduled for today."). Console 404 noise only.\n\n`;
    }

    for (const f of groups[area]) {
      md += `#### ${area} — ${f.viewport} — ${f.kind}\n`;
      md += `- **Failure:** ${f.detail}\n`;
      if (f.snippet) md += `- **Visible text snippet:** \`${String(f.snippet).replace(/`/g, "'")}\`\n`;
      md += `- **Screenshot:** \`${f.screenshot || '(none)'}\`\n\n`;
    }
  }
  for (const area of Object.keys(groups)) {
    if (seen.has(area)) continue;
    md += `### ${area}\n\n`;
    for (const f of groups[area]) {
      md += `#### ${area} — ${f.viewport} — ${f.kind}\n`;
      md += `- **Failure:** ${f.detail}\n`;
      if (f.snippet) md += `- **Visible text snippet:** \`${String(f.snippet).replace(/`/g, "'")}\`\n`;
      md += `- **Screenshot:** \`${f.screenshot || '(none)'}\`\n\n`;
    }
  }
}

md += `## Pages clean (zero assertion failures)\n\n`;
if (cleanRuns.length === 0) {
  md += `_None — every surface × viewport combination produced at least one finding (the universal qb-quarter-chicken-gate.js 404 fires on every page, so this metric is not as informative as the per-surface "Status" lines above)._\n\n`;
} else {
  for (const k of cleanRuns.sort()) md += `- ${k}\n`;
  md += `\n`;
}

md += `## Surfaces NOT broken (page renders without user-visible failure)\n\n`;
md += `Aside from the universal qb-quarter-chicken-gate.js 404 noise, these surfaces render their golden-path UI correctly at all 3 viewports:\n\n`;
md += `- **Inquiries** — page renders, status chips render.\n`;
md += `- **Settings** — sections render, toggles wired.\n`;
md += `- **Quote Builder** — page renders.\n`;
md += `- **Invoice Manager** — page renders, empty-state and pagination correct.\n`;
md += `- **Today** — empty-state renders.\n`;
md += `- **Notification Settings (initial load only)** — renders all 11 toggles. Save is broken (root cause #3) but that needs an interaction to reproduce.\n\n`;

md += `## Surfaces with USER-VISIBLE breakage\n\n`;
md += `1. **Notifications page** — visible "Failed to load." text. Anyone clicking the Notifications nav item sees a broken page. (root cause #2)\n`;
md += `2. **Calendar (perception, not code):** April 2026 shows no events, but May does. The v2-filter fix (#64) is in place; the user's report appears to be the empty current-month state, not a regression. Verify by clicking Next to May. (root cause #5)\n`;
md += `3. **Notification Settings save** — toggles silently fail. Page LOOKS functional; toggling does nothing. (root cause #3)\n`;
md += `4. **Customer Profile direct-nav** — stuck on "Loading…" if reached without first clicking a customer. (root cause #6)\n`;
md += `5. **Pipeline alerts banner** — silently hidden on Kanban + List views; users no longer see Stale Reply / Past Due / Unpaid / Upcoming-48h alerts. (root cause #4)\n\n`;

md += `## How to re-run\n\n`;
md += `\`\`\`bash\n`;
md += `npx playwright test tests/audit/live-deploy-audit.spec.js --reporter=line --workers=4\n`;
md += `node tests/audit/aggregate-findings.js\n`;
md += `\`\`\`\n\n`;
md += `Findings JSON: \`tests/audit/.findings/<slug>-<viewport>.json\` (one per test; intermediate, ignored from commit).\n`;
md += `Screenshots: \`tests/screenshots/audit-2026-04-25/<slug>-<viewport>.png\`.\n`;

fs.writeFileSync(REPORT_PATH, md, 'utf8');
console.log(`Aggregated ${totalFiles.length} test result files into ${REPORT_PATH}`);
console.log(`  Findings: ${allFindings.length}`);
console.log(`  Clean runs: ${cleanRuns.length} / ${totalRuns}`);
