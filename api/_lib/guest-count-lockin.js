/* ===== GUEST COUNT LOCK-IN
   Checks whether a booked inquiry is due for a final guest-count confirmation.
   Setting key: settings:guest_count_lockin_days (integer, default 0 = disabled)
   If lockinDays > 0 and a booked event is exactly lockinDays days away with no
   final_guest_count, creates a notification prompting Zach to confirm.

   Exports: getLockinDays, setLockinDays, checkGuestCountLockin
   ===== */
'use strict';
const https = require('https');
const { createNotification } = require('./notifications.js');

const SETTING_KEY = 'settings:guest_count_lockin_days';

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
    const body = JSON.stringify([['SET', key, String(value)]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function getLockinDays() {
  try {
    const raw = await kvGet(SETTING_KEY);
    if (raw === null || raw === undefined || raw === '') return 0;
    const n = parseInt(typeof raw === 'string' ? raw : String(raw), 10);
    return isNaN(n) || n < 0 ? 0 : n;
  } catch { return 0; }
}

async function setLockinDays(days) {
  const n = parseInt(days, 10);
  if (isNaN(n) || n < 0) throw new Error('days must be a non-negative integer');
  await kvSet(SETTING_KEY, n);
  return n;
}

// Returns today's date string in CT (approximate CST = UTC-6)
function todayCT() {
  const now = new Date();
  const ct  = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  return ct.toISOString().slice(0, 10);
}

// Given a YYYY-MM-DD event date and today, return how many days away the event is.
function daysUntil(eventDateStr, todayStr) {
  const event = new Date(eventDateStr + 'T00:00:00Z');
  const today = new Date(todayStr    + 'T00:00:00Z');
  return Math.round((event - today) / (24 * 60 * 60 * 1000));
}

async function checkGuestCountLockin(inquiry) {
  if (!inquiry) return null;
  if (inquiry.status !== 'booked') return null;

  const ef = inquiry.extracted_fields || {};
  if (!ef.event_date) return null;
  if (inquiry.final_guest_count) return null;

  const lockinDays = await getLockinDays();
  if (lockinDays === 0) return null;

  const today    = todayCT();
  const distance = daysUntil(ef.event_date, today);
  if (distance !== lockinDays) return null;

  const customerName = ef.customer_name || 'customer';
  return createNotification({
    type:      'guest_count_lockin',
    title:     'Confirm final guest count — ' + customerName,
    body:      customerName + "'s event is in " + lockinDays + ' days (' + ef.event_date + '). No final guest count recorded yet.',
    inquiryId: inquiry.threadId || null,
    metadata:  { event_date: ef.event_date, guest_count_estimate: ef.guest_count || null },
    severity:  'medium',
    icon:      'bell',
    sound:     'default',
  });
}

module.exports = { getLockinDays, setLockinDays, checkGuestCountLockin, daysUntil };
