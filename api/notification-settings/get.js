/* GET /api/notification-settings[?tenantId=default]
   Returns the current notification channel + event preferences.
   Defaults everything ON so existing behavior is preserved.
   KV key: notif-settings:{tenantId}
*/
'use strict';
const https = require('https');
const { getFlag } = require('../_lib/flags.js');

const DEFAULT_TENANT = 'default';

const CHANNELS = ['push', 'in_app', 'email', 'sms'];

const EVENTS = [
  'follow_up_due',
  'deposit_overdue',
  'customer_reply',
  'quote_sent',
  'event_tomorrow',
  'event_today',
  'inquiry_needs_review',
];

function buildDefaults() {
  const channels = {};
  CHANNELS.forEach(c => { channels[c] = true; });
  const events = {};
  EVENTS.forEach(e => { events[e] = true; });
  return { channels, events };
}

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

async function getSettings(tenantId) {
  try {
    const raw = await kvGet('notif-settings:' + tenantId);
    if (!raw) return buildDefaults();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const defaults = buildDefaults();
    // Merge stored values over defaults so new channels/events appear ON by default
    return {
      channels: Object.assign({}, defaults.channels, parsed.channels || {}),
      events:   Object.assign({}, defaults.events,   parsed.events   || {}),
    };
  } catch { return buildDefaults(); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const enabled = await getFlag('notification_settings_v1');
  if (!enabled) return res.status(403).json({ error: 'Feature disabled' });

  const tenantId = (req.query && req.query.tenantId) || DEFAULT_TENANT;
  const settings = await getSettings(tenantId);
  return res.status(200).json({ ok: true, tenantId, settings, channels: CHANNELS, events: EVENTS });
};
