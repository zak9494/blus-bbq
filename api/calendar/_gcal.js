/* ===== MODULE: GOOGLE CALENDAR SHARED HELPER
   File: api/calendar/_gcal.js
   Used by: api/calendar/list.js, create.js, update.js, delete.js, webhook.js
   Provides: token management, gcalRequest, getOrCreateCalendarId, KV helpers
   ===== */
'use strict';
const https = require('https');

const CANONICAL_EMAIL = 'info@blusbarbeque.com';
const KV_TOKENS_KEY   = 'gmail:' + CANONICAL_EMAIL;
const CALENDAR_NAME   = "Blu's Barbeque Catering";

/* Keys used across calendar modules */
const CAL_ID_KEY      = 'calendar:id';
const CAL_WATCH_KEY   = 'calendar:watch';
const SYNC_TOKEN_KEY  = 'calendar:syncToken';

/* ── KV helpers ─────────────────────────────── */
function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  return new Promise((resolve) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function kvSet(key, value) {
  return new Promise((resolve) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve();
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

/* ── Token management ───────────────────────── */
async function getAccessToken() {
  const raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('Google account not connected. Visit /api/auth/init to authorize.');
  const tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let { access_token, refresh_token, expiry_date } = tokens;

  // Refresh if within 2 min of expiry
  if (!access_token || (expiry_date && expiry_date < Date.now() + 120000)) {
    if (!refresh_token) throw new Error('No refresh token. Visit /api/auth/init to re-authenticate.');
    const body = new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token,
      grant_type:    'refresh_token',
    }).toString();
    const refreshed = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      };
      const req = https.request(opts, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Token refresh parse error')); } });
      });
      req.on('error', reject);
      req.write(body); req.end();
    });
    if (refreshed.error) throw new Error('Token refresh failed: ' + (refreshed.error_description || refreshed.error));
    access_token = refreshed.access_token;
    const updated = Object.assign({}, tokens, {
      access_token,
      expiry_date: Date.now() + (refreshed.expires_in || 3600) * 1000,
    });
    await kvSet(KV_TOKENS_KEY, JSON.stringify(updated));
  }
  return access_token;
}

/* ── Google Calendar API request ────────────── */
function gcalRequest(method, path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'www.googleapis.com', path, method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}
      )
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ── Resolve calendar ID ─────────────────────
   We use calendar.events scope (sensitive, no app-verification required).
   calendarList.list + calendars.insert both require the broader 'calendar'
   scope (restricted) which Google silently trims to calendar.events for
   unverified apps — so we avoid those API calls entirely.

   Resolution order:
   1. GOOGLE_CALENDAR_ID env var  — admin-set specific calendar ID
   2. KV cache (calendar:id)      — previously resolved / manually set
   3. 'primary'                   — always accessible with calendar.events

   To use a dedicated calendar instead of primary:
   a) Create it in Google Calendar, copy its ID (e.g. abc123@group.calendar.google.com)
   b) Set GOOGLE_CALENDAR_ID=<id> in Vercel env vars, or call kvSet('calendar:id', id)
   ─────────────────────────────────────────── */
async function getOrCreateCalendarId() {
  if (process.env.GOOGLE_CALENDAR_ID) return process.env.GOOGLE_CALENDAR_ID;
  const cached = await kvGet(CAL_ID_KEY);
  if (cached) return cached;
  // Default to primary calendar — works with calendar.events scope
  await kvSet(CAL_ID_KEY, 'primary');
  return 'primary';
}

/* ── Exports ─────────────────────────────────── */
module.exports = {
  kvGet,
  kvSet,
  getAccessToken,
  gcalRequest,
  getOrCreateCalendarId,
  CAL_ID_KEY,
  CAL_WATCH_KEY,
  SYNC_TOKEN_KEY,
};
