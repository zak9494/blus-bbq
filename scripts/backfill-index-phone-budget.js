/**
 * scripts/backfill-index-phone-budget.js
 *
 * Backfills customer_phone and budget into the Kanban index from full inquiry
 * records. Targets only approved, non-archived, non-test entries — the 14
 * entries visible in the Kanban pipeline.
 *
 * Usage:
 *   node scripts/backfill-index-phone-budget.js          # dry-run (default)
 *   node scripts/backfill-index-phone-budget.js --live   # apply changes
 *
 * How it works:
 *   For each Kanban-visible entry it calls POST /api/inquiries/save with just
 *   {threadId}. The save handler re-derives customer_phone and budget from the
 *   full record's extracted_fields and writes them into the index. Idempotent —
 *   re-running when fields are already populated produces no change.
 */

'use strict';

const https = require('https');

const BASE = 'https://blus-bbq.vercel.app';
const SECRET = process.env.BBQ_SECRET || 'c857eb539774b63cf0b0a09303adc78d';
const DRY_RUN = !process.argv.includes('--live');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function get(path) {
  const { status, body } = await request('GET', path);
  if (status !== 200) throw new Error('GET ' + path + ' → HTTP ' + status + ': ' + JSON.stringify(body));
  return body;
}

async function post(path, payload) {
  const { status, body } = await request('POST', path, payload);
  if (status !== 200) throw new Error('POST ' + path + ' → HTTP ' + status + ': ' + JSON.stringify(body));
  return body;
}

async function main() {
  console.log(DRY_RUN ? '[DRY RUN] ' : '[LIVE] ', 'Backfill customer_phone + budget into Kanban index\n');

  const listData = await get('/api/inquiries/list?secret=' + SECRET);
  const allEntries = listData.inquiries || [];

  const targets = allEntries.filter(
    (i) => i.approved === true && i.status !== 'archived' && !i.threadId.startsWith('test-')
  );

  console.log(`Kanban-visible entries: ${targets.length}\n`);

  let phoneFixed = 0;
  let budgetFixed = 0;
  let unchanged = 0;

  for (const entry of targets) {
    const { inquiry } = await get(
      '/api/inquiries/get?threadId=' + entry.threadId + '&secret=' + SECRET
    );
    const ef = (inquiry && inquiry.extracted_fields) || {};

    const srcPhone = ef.customer_phone || null;
    const srcBudget = ef.budget != null ? ef.budget : null;

    const idxPhone = entry.customer_phone || null;
    const idxBudget = entry.budget != null ? entry.budget : null;

    const phoneNeeds = idxPhone !== srcPhone;
    const budgetNeeds = idxBudget !== srcBudget;

    const label = (entry.customer_name || entry.from || entry.threadId.slice(0, 12)).padEnd(22);

    if (!phoneNeeds && !budgetNeeds) {
      unchanged++;
      console.log(`  ${entry.threadId}  ${label}  no change`);
      continue;
    }

    const lines = [];
    if (phoneNeeds) {
      lines.push(`phone: ${JSON.stringify(idxPhone)} → ${JSON.stringify(srcPhone)}`);
      phoneFixed++;
    }
    if (budgetNeeds) {
      lines.push(`budget: ${JSON.stringify(idxBudget)} → ${JSON.stringify(srcBudget)}`);
      budgetFixed++;
    }

    console.log(`  ${entry.threadId}  ${label}  ${lines.join(' | ')}`);

    if (!DRY_RUN) {
      const saveResult = await post('/api/inquiries/save?secret=' + SECRET, { threadId: entry.threadId });
      if (!saveResult.ok) throw new Error('Save failed: ' + JSON.stringify(saveResult));
      console.log(`    → saved (updated_at: ${saveResult.updated_at})`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`  Entries processed : ${targets.length}`);
  console.log(`  phone backfilled  : ${phoneFixed}`);
  console.log(`  budget backfilled : ${budgetFixed}`);
  console.log(`  unchanged         : ${unchanged}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes written. Re-run with --live to apply.');
  } else {
    console.log('\nDone.');
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
