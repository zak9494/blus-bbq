/* ===== MODULE: QUOTE TEMPLATE LIBRARY
   GET    /api/quotes/templates?secret=...               → { ok, templates[] }
   POST   /api/quotes/templates?secret=...               → body { name, line_items, service_type, chicken_calc, default_fees } → { ok, template }
   DELETE /api/quotes/templates/:id?secret=...           → { ok }

   KV keys:
     templates:quotes:index  → JSON array of { id, name, created_at }
     templates:quotes:<id>   → full template record
   ===== */
'use strict';
const https  = require('https');
const crypto = require('crypto');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

function kvSet(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function kvDel(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['DEL', key]]);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

const INDEX_KEY = 'templates:quotes:index';

async function getIndex() {
  const raw = await kvGet(INDEX_KEY);
  if (!raw) return [];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

async function saveIndex(idx) {
  await kvSet(INDEX_KEY, idx);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret   = (req.query || {}).secret;
  const expected = process.env.GMAIL_READ_SECRET;
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Unauthorized' });

  // Extract optional template id from path: /api/quotes/templates/:id
  const parts  = ((req.url || '').split('?')[0]).split('/').filter(Boolean);
  const lastPart = parts[parts.length - 1];
  const templateId = (lastPart && lastPart !== 'templates') ? lastPart : null;

  // ── GET — list all templates ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const idx = await getIndex();
      // Load full records
      const templates = await Promise.all(idx.map(async entry => {
        try {
          const raw = await kvGet('templates:quotes:' + entry.id);
          return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : entry;
        } catch { return entry; }
      }));
      return res.status(200).json({ ok: true, templates: templates.filter(Boolean) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — create or update template ─────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const name = (body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const id  = templateId || ('tpl-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
      const now = new Date().toISOString();
      const tpl = {
        id,
        name,
        line_items:      Array.isArray(body.line_items) ? body.line_items : [],
        service_type:    body.service_type || 'pickup',
        chicken_calc:    body.chicken_calc || null,
        default_fees:    body.default_fees || {},
        service_charge_pct: typeof body.service_charge_pct === 'number' ? body.service_charge_pct : 20,
        delivery_fee:    typeof body.delivery_fee === 'number' ? body.delivery_fee : 0,
        notes:           body.notes || '',
        created_at:      now,
        updated_at:      now,
      };
      await kvSet('templates:quotes:' + id, tpl);

      const idx = await getIndex();
      const existing = idx.findIndex(e => e.id === id);
      if (existing >= 0) {
        idx[existing] = { id, name, updated_at: now };
      } else {
        idx.push({ id, name, created_at: now });
      }
      await saveIndex(idx);

      return res.status(200).json({ ok: true, template: tpl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE — remove template by id ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!templateId) return res.status(400).json({ error: 'template id required in path' });
    try {
      await kvDel('templates:quotes:' + templateId);
      const idx = await getIndex();
      const filtered = idx.filter(e => e.id !== templateId);
      await saveIndex(filtered);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
