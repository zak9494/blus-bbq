#!/usr/bin/env node
/* ===== KV SNAPSHOT — DUMP
   Layer 3 safety net for the Postgres migration (per docs/migration/...
   discussion 2026-04-27): a full point-in-time dump of every Upstash
   KV key relevant to the migration, written as JSON. Idempotent —
   safe to run any time.

   Usage:
     INQ_SECRET=xxx KV_REST_API_URL=... KV_REST_API_TOKEN=... \
       node scripts/migration/dump-kv-snapshot.js > /tmp/kv-dump.json

   What it captures:
     - All keys matching the namespaces in NAMESPACES below.
     - For each: { namespace, key, value, ttl } (ttl in seconds, or null).

   What it does NOT do:
     - Encrypt the output. Treat the file as sensitive (it contains OAuth
       tokens under the gmail:* prefix). Store offline; do not commit.
     - Filter by date. Always dumps the full current state.

   Pair with restore-kv-snapshot.js to replay.
   ===== */
'use strict';
const https = require('https');

// Namespaces to dump. Order is informational only — the snapshot is a
// flat list. Mirrors KV keys documented in CLAUDE.md "KV Keys in Use".
const NAMESPACES = [
  // Auth + sender lockdown
  'gmail:',
  // Inquiries (records + index + helper indices)
  'inquiries:',
  // Calendar
  'calendar:',
  // Deposits
  'deposits:',
  // Notifications + push subs
  'notifications:',
  'push:',
  // Chat
  'chat:',
  // Quotes drafts + templates
  'quotes:',
  // Flags + their index
  'flags:',
  // Self-modify history + phase medians
  'modify-history',
  'modify:',
  // Settings
  'settings:',
  // Customer profiles + tags + notes
  'customer:',
  'customers:',
  // Invoices
  'invoices:',
  'invoice:',
  // Lost reasons / orders
  'orders:',
  // BBQ Gmail label ids
  'bbq:',
];

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function rawGet(pathStr) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url || !tok) return reject(new Error('KV_REST_API_URL / KV_REST_API_TOKEN not set'));
    const u = new URL(url.replace(/\/+$/, '') + pathStr);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return reject(new Error('KV ' + pathStr + ' failed: ' + r.statusCode + ' ' + d.slice(0, 200)));
        }
        try { resolve(JSON.parse(d).result); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function scanAll(matchPattern) {
  const all = [];
  let cursor = '0';
  let safety = 0;
  do {
    safety++;
    if (safety > 5000) throw new Error('scanAll safety break');
    const path = '/scan/' + cursor +
      (matchPattern ? '/match/' + encodeURIComponent(matchPattern) : '') +
      '/count/500';
    const result = await rawGet(path);
    if (Array.isArray(result) && result.length === 2) {
      cursor = String(result[0]);
      if (Array.isArray(result[1])) all.push(...result[1]);
    } else {
      break;
    }
  } while (cursor !== '0');
  return all;
}

async function getValue(key) {
  return rawGet('/get/' + encodeURIComponent(key));
}

async function getTtl(key) {
  try {
    const r = await rawGet('/ttl/' + encodeURIComponent(key));
    if (typeof r === 'number') return r >= 0 ? r : null;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.INQ_SECRET && !process.env.SELF_MODIFY_SECRET) {
    process.stderr.write('[dump-kv-snapshot] WARNING: INQ_SECRET / SELF_MODIFY_SECRET not set; ' +
      'this is a local-only sanity check — script does not call any privileged API endpoints, ' +
      'but you should still treat the output as sensitive.\n');
  }
  if (!kvUrl() || !kvToken()) {
    process.stderr.write('[dump-kv-snapshot] ERROR: KV_REST_API_URL / KV_REST_API_TOKEN are required\n');
    process.exit(2);
  }

  const collected = [];
  const seen = new Set();
  for (const ns of NAMESPACES) {
    const pattern = ns.endsWith(':') ? ns + '*' : ns;
    let keys = [];
    try {
      keys = await scanAll(pattern);
    } catch (err) {
      process.stderr.write('[dump-kv-snapshot] scan ' + pattern + ' failed: ' + err.message + '\n');
      continue;
    }
    process.stderr.write('[dump-kv-snapshot] ' + pattern + ': ' + keys.length + ' keys\n');
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      let value = null, ttl = null;
      try { value = await getValue(key); } catch (err) {
        process.stderr.write('[dump-kv-snapshot] get ' + key + ' failed: ' + err.message + '\n');
        continue;
      }
      try { ttl = await getTtl(key); } catch {}
      collected.push({ namespace: ns, key, value, ttl });
    }
  }

  const snapshot = {
    version: 1,
    captured_at: new Date().toISOString(),
    source: 'upstash-kv',
    count: collected.length,
    entries: collected,
  };
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
  process.stderr.write('[dump-kv-snapshot] wrote ' + collected.length + ' entries\n');
}

main().catch(err => {
  process.stderr.write('[dump-kv-snapshot] FATAL: ' + (err && err.stack || err) + '\n');
  process.exit(1);
});
