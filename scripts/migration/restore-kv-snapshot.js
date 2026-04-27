#!/usr/bin/env node
/* ===== KV SNAPSHOT — RESTORE
   Companion to dump-kv-snapshot.js. Replays a JSON snapshot back into
   Upstash KV. Use this if BOTH KV and Postgres get corrupted during
   migration cutover.

   Usage:
     KV_REST_API_URL=... KV_REST_API_TOKEN=... \
       node scripts/migration/restore-kv-snapshot.js /tmp/kv-dump.json

   Optional flags:
     --dry-run      Print what would be written, do not call Upstash.
     --filter=NS    Only restore keys whose `namespace` starts with NS.
     --skip=KEY     Skip a specific key (repeatable).

   Safety:
     - SET is destructive — it overwrites the existing value at each key.
       For deposits/inquiries/quotes that may have been edited since the
       snapshot, this WILL roll back those edits. Run dry-run first.
     - The script does NOT delete keys that exist in KV but are absent
       from the snapshot. It is additive/overwriting only.
   ===== */
'use strict';
const fs = require('fs');
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvPost(pathSuffix, body, contentType) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url.replace(/\/+$/, '') + pathSuffix);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function setKey(key, value, ttlSeconds) {
  const stringVal = typeof value === 'string' ? value : JSON.stringify(value);
  const r = await kvPost('/set/' + encodeURIComponent(key), stringVal, 'text/plain');
  if (r.status < 200 || r.status >= 300) {
    throw new Error('SET ' + key + ' failed: ' + r.status + ' ' + (r.body || '').slice(0, 200));
  }
  if (ttlSeconds && ttlSeconds > 0) {
    const tr = await kvPost('/expire/' + encodeURIComponent(key) + '/' + ttlSeconds, '', 'text/plain');
    if (tr.status < 200 || tr.status >= 300) {
      process.stderr.write('[restore] ttl set failed for ' + key + ': ' + tr.status + '\n');
    }
  }
}

function parseArgs(argv) {
  const args = { file: null, dryRun: false, filter: null, skip: new Set() };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--filter=')) args.filter = a.slice('--filter='.length);
    else if (a.startsWith('--skip=')) args.skip.add(a.slice('--skip='.length));
    else if (!args.file && !a.startsWith('--')) args.file = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    process.stderr.write('Usage: restore-kv-snapshot.js <snapshot.json> [--dry-run] [--filter=ns] [--skip=key]...\n');
    process.exit(2);
  }
  if (!args.dryRun && (!kvUrl() || !kvToken())) {
    process.stderr.write('[restore] ERROR: KV_REST_API_URL / KV_REST_API_TOKEN required (or pass --dry-run)\n');
    process.exit(2);
  }

  const raw = fs.readFileSync(args.file, 'utf8');
  let snap;
  try { snap = JSON.parse(raw); } catch (err) {
    process.stderr.write('[restore] failed to parse snapshot: ' + err.message + '\n');
    process.exit(2);
  }
  if (!snap || !Array.isArray(snap.entries)) {
    process.stderr.write('[restore] snapshot missing .entries array\n');
    process.exit(2);
  }

  process.stderr.write('[restore] snapshot ' + snap.captured_at + ' — ' + snap.entries.length + ' entries\n');
  if (args.dryRun) process.stderr.write('[restore] DRY RUN — no writes\n');

  let written = 0, skipped = 0, errors = 0;
  for (const e of snap.entries) {
    if (args.filter && !e.namespace.startsWith(args.filter)) { skipped++; continue; }
    if (args.skip.has(e.key)) { skipped++; continue; }
    if (e.value === null || e.value === undefined) { skipped++; continue; }
    if (args.dryRun) {
      process.stdout.write('SET ' + e.key + (e.ttl ? ' (TTL ' + e.ttl + 's)' : '') + '\n');
      written++;
      continue;
    }
    try {
      await setKey(e.key, e.value, e.ttl);
      written++;
    } catch (err) {
      errors++;
      process.stderr.write('[restore] ' + e.key + ': ' + err.message + '\n');
    }
  }
  process.stderr.write('[restore] done — written=' + written + ' skipped=' + skipped + ' errors=' + errors + '\n');
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  process.stderr.write('[restore] FATAL: ' + (err && err.stack || err) + '\n');
  process.exit(1);
});
