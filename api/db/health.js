/* ===== POSTGRES HEALTH ENDPOINT
   GET /api/db/health
   Reports whether the Postgres connection is configured and reachable.

   Returns 200 in all configured states (so monitors can poll without
   fighting non-2xx); the JSON body's `ok` field is the actual signal:

     { ok: false, status: 'POSTGRES_URL not configured' }
        → env var is unset; Phase 1 default state, NOT a problem.
     { ok: true, alive: true }
        → connection is up.
     { ok: false, status: 'connection failed', error: '<message>' }
        → env var present but Postgres is unreachable. Page someone.

   Auth: same INQ_SECRET / SELF_MODIFY_SECRET gate other diag endpoints
   use. Returns 401 if missing.
   ===== */
'use strict';
const { isAvailable, query } = require('../_lib/db.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const secret = q.secret;
  const expected = process.env.INQ_SECRET || process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isAvailable()) {
    return res.status(200).json({
      ok: false,
      status: 'POSTGRES_URL not configured',
      phase: 'phase-1-scaffolding',
    });
  }

  try {
    const r = await query('SELECT 1 as alive');
    const alive = r && r.rows && r.rows[0] && r.rows[0].alive === 1;
    return res.status(200).json({ ok: !!alive, alive: !!alive, phase: 'phase-1-scaffolding' });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      status: 'connection failed',
      error: (err && err.message) || String(err),
      phase: 'phase-1-scaffolding',
    });
  }
};
