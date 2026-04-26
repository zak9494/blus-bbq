/* ===== INVOICE MANAGER — shared KV helpers + model utils ===== */
'use strict';
const https   = require('https');
const { getFlag } = require('../_lib/flags.js');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search,
        method: 'GET', headers: { Authorization: 'Bearer ' + tok } },
      r => { let d = ''; r.on('data', c => d += c);
             r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } }); }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

function kvSet(key, value) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve();
    const payload = JSON.stringify(['set', key, typeof value === 'string' ? value : JSON.stringify(value)]);
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: '/', method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(payload) } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve()); }
    );
    req.on('error', () => resolve());
    req.write(payload); req.end();
  });
}

function kvIncr(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(1);
    const payload = JSON.stringify(['incr', key]);
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: '/', method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(payload) } },
      r => { let d = ''; r.on('data', c => d += c);
             r.on('end', () => { try { resolve(JSON.parse(d).result || 1); } catch { resolve(1); } }); }
    );
    req.on('error', () => resolve(1));
    req.write(payload); req.end();
  });
}

function parseBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function today()    { return isoDate(new Date()); }
function newId(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

function computeStatus(inv) {
  if (inv.status === 'void' || inv.status === 'refunded') return inv.status;
  const total   = inv.total      || 0;
  const amtPaid = inv.amountPaid || 0;
  const balance = total - amtPaid;
  if (total > 0 && balance <= 0.005) return 'paid';
  if (amtPaid > 0.005) {
    if (inv.dueDate && inv.dueDate < today()) return 'past_due';
    return 'partial';
  }
  if (inv.dueDate && inv.dueDate < today()) return 'past_due';
  return inv.status || 'draft';
}

function indexEntry(inv) {
  return {
    id:            inv.id,
    invoiceNumber: inv.invoiceNumber || '',
    threadId:      inv.threadId      || null,
    customerId:    inv.customerId    || '',
    customerName:  inv.customerName  || '',
    customerEmail: inv.customerEmail || '',
    eventDate:     inv.eventDate     || null,
    issueDate:     inv.issueDate     || null,
    dueDate:       inv.dueDate       || null,
    serviceType:   inv.serviceType   || 'pickup',
    total:         inv.total         || 0,
    amountPaid:    inv.amountPaid    || 0,
    balance:       inv.balance       || 0,
    status:        inv.status        || 'draft',
    created_at:    inv.created_at,
    updated_at:    inv.updated_at,
  };
}

async function loadIndex() {
  try {
    const raw = await kvGet('invoices:index');
    const arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function saveIndex(arr) {
  await kvSet('invoices:index', arr.slice(0, 500));
}

async function requireFlag(res) {
  try {
    const on = await getFlag('invoice_manager_v1');
    if (!on) { res.status(403).json({ error: 'invoice_manager_v1 flag is OFF' }); return false; }
    return true;
  } catch {
    res.status(500).json({ error: 'Flag check failed' });
    return false;
  }
}

function secretOk(body) {
  const secret = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!secret) return true;
  return !!(body && body.secret === secret);
}

module.exports = { kvGet, kvSet, kvIncr, parseBody, isoDate, today, newId,
                   computeStatus, indexEntry, loadIndex, saveIndex, requireFlag, secretOk };
