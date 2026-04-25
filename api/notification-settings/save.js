/* POST /api/notification-settings
   Body: { tenantId?, channels: { push?, in_app?, email?, sms? }, events: { ... } }
   Merges provided keys into stored settings; unknown keys are ignored.
   KV key: notif-settings:{tenantId}
*/
'use strict';
const https = require('https');
const { getFlag } = require('../_lib/flags.js');

const DEFAULT_TENANT = 'default';

const ALLOWED_CHANNELS = new Set(['push', 'in_app', 'email', 'sms']);
const ALLOWED_EVENTS   = new Set([
  'follow_up_due', 'deposit_overdue', 'customer_reply',
  'quote_sent', 'event_tomorrow', 'event_today', 'inquiry_needs_review',
]);

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
    const body = JSON.stringify([['SET', key, JSON.stringify(value)]]);
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

async function loadExisting(tenantId) {
  try {
    const raw = await kvGet('notif-settings:' + tenantId);
    if (!raw) return { channels: {}, events: {} };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      channels: parsed.channels || {},
      events:   parsed.events   || {},
    };
  } catch { return { channels: {}, events: {} }; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const enabled = await getFlag('notification_settings_v1');
  if (!enabled) return res.status(403).json({ error: 'Feature disabled' });

  const secret = process.env.GMAIL_READ_SECRET;
  const body = req.body || {};
  const provided = body.secret || req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const tenantId = body.tenantId || DEFAULT_TENANT;
  const existing = await loadExisting(tenantId);

  const inChannels = body.channels && typeof body.channels === 'object' ? body.channels : {};
  const inEvents   = body.events   && typeof body.events   === 'object' ? body.events   : {};

  // Merge — only allow known keys, only allow boolean values
  const channels = Object.assign({}, existing.channels);
  for (const [k, v] of Object.entries(inChannels)) {
    if (ALLOWED_CHANNELS.has(k)) channels[k] = !!v;
  }

  const events = Object.assign({}, existing.events);
  for (const [k, v] of Object.entries(inEvents)) {
    if (ALLOWED_EVENTS.has(k)) events[k] = !!v;
  }

  const record = { channels, events, updated_at: new Date().toISOString() };
  await kvSet('notif-settings:' + tenantId, record);

  return res.status(200).json({ ok: true, tenantId, settings: { channels, events } });
};
