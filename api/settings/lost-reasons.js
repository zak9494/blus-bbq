/* GET  /api/settings/lost-reasons?secret=...
   POST /api/settings/lost-reasons
        body: { reasons: string[], secret }
   Returns { ok, reasons: string[] }
   KV key: settings:lost_reasons
   Default seeds: Budget too high, Competitor, No response from customer, Event cancelled, Other
*/
'use strict';
const https = require('https');
const { getFlag } = require('../_lib/flags.js');

const DEFAULT_REASONS = [
  'Budget too high',
  'Competitor',
  'No response from customer',
  'Event cancelled',
  'Other',
];

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

async function getReasons() {
  try {
    const raw = await kvGet('settings:lost_reasons');
    if (!raw) return DEFAULT_REASONS.slice();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_REASONS.slice();
  } catch { return DEFAULT_REASONS.slice(); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) ||
                   (req.body && req.body.secret) ||
                   req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const reasons = await getReasons();
    return res.status(200).json({ ok: true, reasons });
  }

  if (req.method === 'POST') {
    const enabled = await getFlag('lost_reason_capture', true);
    if (!enabled) return res.status(403).json({ error: 'Feature disabled' });

    const body = req.body || {};
    const reasons = Array.isArray(body.reasons) ? body.reasons.map(r => String(r).trim()).filter(Boolean) : null;
    if (!reasons || !reasons.length) return res.status(400).json({ error: 'reasons array required' });

    await kvSet('settings:lost_reasons', reasons);
    return res.status(200).json({ ok: true, reasons });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
