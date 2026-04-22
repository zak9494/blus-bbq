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
];

async function getFlag(name, defaultValue = false) {
  try {
    const raw = await kvGet('flags:' + name);
    if (!raw) return defaultValue;
    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof rec.enabled === 'boolean' ? rec.enabled : defaultValue;
  } catch {
    return defaultValue;
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
    return {
      name,
      enabled:     rec ? !!rec.enabled : false,
      description: (rec && rec.description) || (seed && seed.description) || '',
      created_at:  (rec && rec.created_at) || null,
    };
  }));

  return results;
}

module.exports = { getFlag, setFlag, listFlags, SEED_FLAGS };
