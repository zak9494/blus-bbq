/* ===== KV helpers for the data/* stub modules
   Centralized Upstash KV access for Phase 1 entity stubs. Mirrors the
   inline kvGet/kvSet found in api/deposits/list.js and api/_lib/flags.js
   so that a future migration can update them in one place.

   Why this lives under api/_lib/data/ and not api/_lib/:
   - It is a shim only the entity-stub modules need. The handlers that
     pre-date this PR continue to use their own inline helpers; we are
     not retrofitting every handler in Phase 1 (CLAUDE.md "forward-only"
     rule).
   - Keeping it here makes the dependency graph obvious — every file
     in api/_lib/data/ depends on _kv.js and (later) ./db.js.

   Same loud-on-failure semantics as flags.js#kvSet (PR #105):
   - kvSet throws if the write does not produce an OK result *and* the
     readback does not match.
   - kvGet rejects on non-2xx HTTP status.
   ===== */
'use strict';
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url.replace(/\/+$/, '') + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return reject(new Error('KV GET ' + key + ' failed: ' + r.statusCode + ' ' + d.slice(0, 200)));
        }
        try { resolve(JSON.parse(d).result); } catch { resolve(null); }
      });
    });
    req.on('error', reject); req.end();
  });
}

function kvPost(pathSuffix, body, contentType) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url.replace(/\/+$/, '') + pathSuffix);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function kvSet(key, value) {
  const stringVal = typeof value === 'string' ? value : JSON.stringify(value);
  let lastErr = null;

  try {
    const r = await kvPost('/set/' + encodeURIComponent(key), stringVal, 'text/plain');
    if (r.status >= 200 && r.status < 300) {
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch {}
      if (parsed && parsed.result === 'OK') return parsed;
      lastErr = new Error('KV /set ' + key + ' unexpected result: ' + (r.body || '').slice(0, 200));
    } else {
      lastErr = new Error('KV /set ' + key + ' failed: ' + r.status + ' ' + (r.body || '').slice(0, 200));
    }
  } catch (e) {
    lastErr = e;
  }

  try {
    const body = JSON.stringify([['SET', key, stringVal]]);
    const r = await kvPost('/pipeline', body, 'application/json');
    if (r.status >= 200 && r.status < 300) {
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch {}
      const ok = Array.isArray(parsed)
        ? parsed.length > 0 && parsed[0] && parsed[0].result === 'OK' && !parsed[0].error
        : parsed && parsed.result === 'OK';
      if (ok) {
        const readback = await kvGet(key);
        if (readback === stringVal) return parsed;
        lastErr = new Error('KV SET ' + key + ' readback mismatch (stored ' +
          (readback === null ? 'null' : 'differs') + ')');
      } else {
        lastErr = new Error('KV /pipeline ' + key + ' unexpected result: ' + (r.body || '').slice(0, 200));
      }
    } else {
      lastErr = new Error('KV /pipeline ' + key + ' failed: ' + r.status + ' ' + (r.body || '').slice(0, 200));
    }
  } catch (e) {
    lastErr = e;
  }

  throw lastErr || new Error('KV SET ' + key + ' failed: no successful path');
}

// Best-effort SCAN across all keys — used by snapshot scripts and any
// future bulk-read paths. Walks the cursor until exhausted.
async function kvScan(matchPattern) {
  const url = kvUrl(), tok = kvToken();
  if (!url) throw new Error('KV env vars not set');
  const all = [];
  let cursor = '0';
  let safety = 0;
  do {
    safety++;
    if (safety > 1000) throw new Error('kvScan safety break — too many iterations');
    const params = new URLSearchParams();
    params.set('cursor', cursor);
    if (matchPattern) params.set('match', matchPattern);
    params.set('count', '500');
    const u = new URL(url.replace(/\/+$/, '') + '/scan/' + cursor +
      (matchPattern ? '/match/' + encodeURIComponent(matchPattern) : '') + '/count/500');
    const result = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
        method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => {
          if (r.statusCode < 200 || r.statusCode >= 300) {
            return reject(new Error('KV SCAN failed: ' + r.statusCode + ' ' + d.slice(0, 200)));
          }
          try { resolve(JSON.parse(d).result); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject); req.end();
    });
    // Upstash returns [cursor, [keys...]]
    if (Array.isArray(result) && result.length === 2) {
      cursor = String(result[0]);
      if (Array.isArray(result[1])) all.push(...result[1]);
    } else {
      break;
    }
  } while (cursor !== '0');
  return all;
}

module.exports = { kvGet, kvSet, kvScan };
