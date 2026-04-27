/* ===== POSTGRES CONNECTION MODULE
   Phase 1 of Upstash KV → Postgres migration. Loads lazily from
   POSTGRES_URL (pooled, for serverless reads/writes) and
   POSTGRES_URL_NON_POOLING (single connection, used by node-pg-migrate
   and any code that needs a stable session — listen/notify, advisory
   locks, etc.).

   Behavior when env vars are missing:
   - Does NOT throw on require/init.
   - getPool() / getDirectPool() return null.
   - isAvailable() returns false.
   - query() throws a clear "Postgres not configured" error so callers
     fall back to KV gracefully.

   Phase 1 contract: this module exists, but no caller is required to use
   it yet. Phase 2+ will introduce dual-writes per entity, gated by the
   pg_writes_enabled flag (default OFF).

   Connection re-use: in serverless Vercel functions, modules are cached
   per warm instance. We hold onto a single pg.Pool per instance (max=5)
   so concurrent requests share connections.
   ===== */
'use strict';

let _Pool = null;
try {
  _Pool = require('pg').Pool;
} catch (err) {
  // pg not installed yet (e.g. during install step) — defer the failure
  // until something actually tries to connect.
  console.warn('[db] pg module unavailable:', err.message);
}

let _pool = null;
let _directPool = null;
let _initialized = false;

function init() {
  if (_initialized) return;
  _initialized = true;

  if (!_Pool) return;

  if (process.env.POSTGRES_URL) {
    try {
      _pool = new _Pool({
        connectionString: process.env.POSTGRES_URL,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
      _pool.on('error', err => console.error('[db] pool error:', err && err.message));
    } catch (err) {
      console.warn('[db] failed to init pooled connection:', err.message);
      _pool = null;
    }
  }

  if (process.env.POSTGRES_URL_NON_POOLING) {
    try {
      _directPool = new _Pool({
        connectionString: process.env.POSTGRES_URL_NON_POOLING,
        max: 1,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
      });
      _directPool.on('error', err => console.error('[db] direct pool error:', err && err.message));
    } catch (err) {
      console.warn('[db] failed to init direct connection:', err.message);
      _directPool = null;
    }
  }
}

function getPool()       { init(); return _pool; }
function getDirectPool() { init(); return _directPool; }
function isAvailable()   { init(); return _pool !== null; }

async function query(sql, params = []) {
  init();
  if (!_pool) throw new Error('Postgres not configured (POSTGRES_URL missing)');
  return _pool.query(sql, params);
}

// Convenience: run something and reliably release on errors.
async function withClient(fn) {
  init();
  if (!_pool) throw new Error('Postgres not configured (POSTGRES_URL missing)');
  const client = await _pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = { getPool, getDirectPool, isAvailable, query, withClient };
