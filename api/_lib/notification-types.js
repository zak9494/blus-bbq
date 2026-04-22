/* ===== NOTIFICATION TYPES REGISTRY
   Seed list of notification type IDs with default text/sound/icon.
   Overrides are stored in KV at notifications:types:<id>.
   Zach will finalize the full list before Group 5 UI build.

   Exports: SEED_TYPES, getType, listTypes, upsertType
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

const TYPE_PREFIX = 'notifications:types:';

const SEED_TYPES = [
  { id: 'follow_up_due',        defaultText: 'Follow-up is due',          defaultSound: 'chime', defaultIcon: 'clock' },
  { id: 'deposit_overdue',      defaultText: 'Deposit payment overdue',    defaultSound: 'alert', defaultIcon: 'dollar' },
  { id: 'customer_reply',       defaultText: 'Customer replied',           defaultSound: 'chime', defaultIcon: 'message' },
  { id: 'quote_sent',           defaultText: 'Quote sent to customer',     defaultSound: 'none',  defaultIcon: 'document' },
  { id: 'event_tomorrow',       defaultText: 'Event is tomorrow',          defaultSound: 'chime', defaultIcon: 'calendar' },
  { id: 'event_today',          defaultText: 'Event is today',             defaultSound: 'alert', defaultIcon: 'calendar' },
  { id: 'inquiry_needs_review', defaultText: 'Inquiry needs review',       defaultSound: 'chime', defaultIcon: 'eye' },
];

function parseRaw(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

async function getType(id) {
  const seed = SEED_TYPES.find(t => t.id === id) || null;
  const raw  = await kvGet(TYPE_PREFIX + id).catch(() => null);
  const override = parseRaw(raw);
  if (!override) return seed;
  return Object.assign({}, seed || { id }, override);
}

async function listTypes() {
  const results = await Promise.all(SEED_TYPES.map(t => getType(t.id)));
  return results.filter(Boolean);
}

async function upsertType(id, fields) {
  const existing = await getType(id);
  const record = Object.assign({}, existing || { id }, fields, {
    id,
    updatedAt: new Date().toISOString(),
  });
  await kvSet(TYPE_PREFIX + id, JSON.stringify(record));
  return record;
}

module.exports = { SEED_TYPES, getType, listTypes, upsertType };
