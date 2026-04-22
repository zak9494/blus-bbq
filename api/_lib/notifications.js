/* ===== NOTIFICATIONS STORE
   KV-backed CRUD for the notifications center.

   KV keys:
     notifications:list          — sorted set (score=createdAt epoch ms, member=id)
     notifications:item:<id>     — JSON notification record
     notifications:unread_count  — integer string (decremented on read, SET 0 on markAllRead)

   Exports: createNotification, listNotifications, getNotification,
            markRead, markAllRead, dismissNotification,
            deleteNotification, getUnreadCount
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

async function kvExec(commands) {
  const url = kvUrl(), token = kvToken();
  if (!url || !token) throw new Error('KV env vars not set');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(url + '/pipeline');
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

const LIST_KEY  = 'notifications:list';
const COUNT_KEY = 'notifications:unread_count';
const MAX_FETCH = 200;

function itemKey(id) { return 'notifications:item:' + id; }

// Monotonically increasing score so burst creates within the same ms stay ordered.
// score = epoch_ms * 1000 + counter — stays within Number.MAX_SAFE_INTEGER until ~2255.
let _scoreSeq = 0;
function makeScore() {
  return Date.now() * 1000 + (_scoreSeq++ % 1000);
}

function makeId() {
  return 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function parseItem(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

async function createNotification({
  type, title, body, metadata = {}, customerId = null, inquiryId = null,
  severity = 'medium', sound = 'default', icon = 'bell',
}) {
  if (!type || !title) throw new Error('type and title are required');
  const id  = makeId();
  const now = new Date().toISOString();
  const record = {
    id, type, title, body: body || '', metadata, customerId, inquiryId,
    severity, sound, icon, read: false, dismissed: false, createdAt: now,
  };
  const score = makeScore();
  await kvExec([
    ['SET',  itemKey(id), JSON.stringify(record)],
    ['ZADD', LIST_KEY, score, id],
    ['INCR', COUNT_KEY],
  ]);
  return record;
}

async function listNotifications({ limit = 50, offset = 0, unread_only = false, type = null } = {}) {
  const step1 = await kvExec([
    ['ZREVRANGE', LIST_KEY, 0, MAX_FETCH - 1],
    ['GET', COUNT_KEY],
  ]);
  const ids         = (step1[0] && step1[0].result) || [];
  const unread_count = Math.max(0, parseInt((step1[1] && step1[1].result) || '0', 10) || 0);

  if (!ids.length) return { notifications: [], total: 0, unread_count };

  const step2 = await kvExec(ids.map(id => ['GET', itemKey(id)]));
  let items = step2.map(r => parseItem(r && r.result)).filter(Boolean);

  if (unread_only) items = items.filter(n => !n.read);
  if (type) items = items.filter(n => n.type === type);

  const total = items.length;
  return { notifications: items.slice(offset, offset + limit), total, unread_count };
}

async function getNotification(id) {
  const raw = await kvGet(itemKey(id));
  return parseItem(raw);
}

async function markRead(id) {
  const raw = await kvGet(itemKey(id));
  const item = parseItem(raw);
  if (!item) return null;
  if (item.read) return item;
  item.read   = true;
  item.readAt = new Date().toISOString();
  await kvExec([
    ['SET',  itemKey(id), JSON.stringify(item)],
    ['DECR', COUNT_KEY],
  ]);
  return item;
}

async function markAllRead() {
  const step1 = await kvExec([['ZREVRANGE', LIST_KEY, 0, -1]]);
  const ids   = (step1[0] && step1[0].result) || [];
  if (!ids.length) return { updated: 0 };

  const step2 = await kvExec(ids.map(id => ['GET', itemKey(id)]));
  const now   = new Date().toISOString();
  const updates = [];

  step2.forEach((r, i) => {
    const item = parseItem(r && r.result);
    if (!item || item.read) return;
    item.read   = true;
    item.readAt = now;
    updates.push(['SET', itemKey(ids[i]), JSON.stringify(item)]);
  });

  if (updates.length > 0) {
    await kvExec([...updates, ['SET', COUNT_KEY, '0']]);
  }
  return { updated: updates.length };
}

async function dismissNotification(id) {
  const raw  = await kvGet(itemKey(id));
  const item = parseItem(raw);
  if (!item) return null;
  item.dismissed   = true;
  item.dismissedAt = new Date().toISOString();
  await kvExec([['SET', itemKey(id), JSON.stringify(item)]]);
  return item;
}

async function deleteNotification(id) {
  const raw  = await kvGet(itemKey(id));
  const item = parseItem(raw);
  if (!item) return null;
  const cmds = [
    ['DEL',  itemKey(id)],
    ['ZREM', LIST_KEY, id],
  ];
  if (!item.read) cmds.push(['DECR', COUNT_KEY]);
  await kvExec(cmds);
  return { deleted: true, id };
}

async function getUnreadCount() {
  const raw = await kvGet(COUNT_KEY);
  return Math.max(0, parseInt(raw, 10) || 0);
}

module.exports = {
  createNotification, listNotifications, getNotification,
  markRead, markAllRead, dismissNotification,
  deleteNotification, getUnreadCount,
};
