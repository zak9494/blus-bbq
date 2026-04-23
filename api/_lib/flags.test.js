'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Set KV env vars BEFORE loading flags.js (kvGet/kvSet check these at call time)
process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
process.env.KV_REST_API_TOKEN = 'mock-token';

// ── KV mock ───────────────────────────────────────────────────────────────────
// Intercept https.request before requiring flags.js so flags.js uses our mock.
const https = require('https');

const _store = {};

function mockRequest(opts, cb) {
  const path   = typeof opts === 'string' ? opts : (opts.path || '');
  const method = (typeof opts === 'object' && opts.method) ? opts.method : 'GET';

  const bodyChunks = [];
  const res = {
    statusCode: 200,
    on(event, handler) {
      if (event === 'data') res._dataHandler = handler;
      if (event === 'end')  res._endHandler  = handler;
      return res;
    },
    resume() { return res; },
  };

  const req = {
    write(chunk) { bodyChunks.push(chunk); },
    end() {
      let responseBody;
      if (method === 'GET') {
        // Matches: /get/:encoded-key
        const m = path.match(/\/get\/([^?]+)/);
        if (m) {
          const key = decodeURIComponent(m[1]);
          const val = Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null;
          responseBody = JSON.stringify({ result: val });
        } else {
          responseBody = JSON.stringify({ result: null });
        }
      } else {
        // POST /pipeline — body is [[cmd, key, val], ...]
        const raw = bodyChunks.join('');
        let cmds = [];
        try { cmds = JSON.parse(raw); } catch { cmds = []; }
        // Pipeline format: array of command arrays
        if (Array.isArray(cmds) && Array.isArray(cmds[0])) {
          cmds.forEach(function(cmd) {
            if (cmd[0] === 'SET') _store[cmd[1]] = cmd[2];
          });
        }
        responseBody = JSON.stringify([{ result: 'OK' }]);
      }

      if (cb) cb(res);
      if (res._dataHandler) res._dataHandler(responseBody);
      if (res._endHandler)  res._endHandler();
    },
    on() { return req; },
  };
  return req;
}

// Patch https.request before module load
const _orig = https.request;
https.request = mockRequest;

// Now load the module under test
const { getFlag, setFlag, listFlags, SEED_FLAGS } = require('./flags.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
function clearStore() {
  Object.keys(_store).forEach(k => delete _store[k]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SEED_FLAGS', () => {
  it('contains at least 8 entries', () => {
    assert.ok(SEED_FLAGS.length >= 8, 'expected at least 8 seed flags, got ' + SEED_FLAGS.length);
  });
  it('contains test_customer_mode', () => {
    assert.ok(SEED_FLAGS.some(f => f.name === 'test_customer_mode'));
  });
  it('all entries have name and description', () => {
    SEED_FLAGS.forEach(f => {
      assert.ok(f.name, 'missing name');
      assert.ok(f.description, 'missing description for ' + f.name);
    });
  });
});

describe('getFlag', () => {
  before(clearStore);

  it('returns defaultValue (false) when key absent', async () => {
    clearStore();
    const val = await getFlag('nonexistent_flag');
    assert.equal(val, false);
  });

  it('returns custom defaultValue when key absent', async () => {
    clearStore();
    const val = await getFlag('nonexistent_flag', true);
    assert.equal(val, true);
  });

  it('returns stored enabled=true', async () => {
    clearStore();
    _store['flags:my_flag'] = JSON.stringify({ enabled: true, description: 'test', created_at: new Date().toISOString() });
    const val = await getFlag('my_flag');
    assert.equal(val, true);
  });

  it('returns stored enabled=false', async () => {
    clearStore();
    _store['flags:my_flag'] = JSON.stringify({ enabled: false, description: 'test', created_at: new Date().toISOString() });
    const val = await getFlag('my_flag');
    assert.equal(val, false);
  });
});

describe('setFlag', () => {
  it('writes flag record to KV with correct shape', async () => {
    clearStore();
    const rec = await setFlag('kanban_restructure', true, 'My desc');
    assert.equal(rec.enabled, true);
    assert.equal(rec.description, 'My desc');
    assert.ok(rec.created_at);
    assert.ok(rec.updated_at);
  });

  it('persists so getFlag reads back the same value', async () => {
    clearStore();
    await setFlag('sms_channel', true, 'SMS');
    const val = await getFlag('sms_channel');
    assert.equal(val, true);
  });

  it('setFlag false → getFlag returns false', async () => {
    clearStore();
    await setFlag('sms_channel', true, 'SMS');
    await setFlag('sms_channel', false, 'SMS');
    const val = await getFlag('sms_channel');
    assert.equal(val, false);
  });

  it('preserves existing description when none provided', async () => {
    clearStore();
    await setFlag('deposit_tracking', true, 'Original desc');
    const rec = await setFlag('deposit_tracking', false);
    assert.equal(rec.description, 'Original desc');
  });

  it('preserves created_at on second write', async () => {
    clearStore();
    const first = await setFlag('ai_quote_updates', true, 'desc');
    await new Promise(r => setTimeout(r, 5));
    const second = await setFlag('ai_quote_updates', false, 'desc');
    assert.equal(first.created_at, second.created_at);
  });

  it('adds name to flags:_index', async () => {
    clearStore();
    await setFlag('notifications_center', true, 'desc');
    const raw = _store['flags:_index'];
    assert.ok(raw, 'flags:_index should be written');
    const index = JSON.parse(raw);
    assert.ok(Array.isArray(index));
    assert.ok(index.includes('notifications_center'));
  });

  it('does not duplicate name in flags:_index', async () => {
    clearStore();
    await setFlag('kanban_restructure', true, 'desc');
    await setFlag('kanban_restructure', false, 'desc');
    const raw = _store['flags:_index'];
    const index = JSON.parse(raw);
    const count = index.filter(n => n === 'kanban_restructure').length;
    assert.equal(count, 1);
  });
});

describe('listFlags', () => {
  it('returns at least the 6 seeded flags when KV is empty', async () => {
    clearStore();
    const flags = await listFlags();
    assert.ok(Array.isArray(flags));
    assert.ok(flags.length >= 8);
    const names = flags.map(f => f.name);
    SEED_FLAGS.forEach(s => assert.ok(names.includes(s.name), 'missing seed: ' + s.name));
  });

  it('seed flags default to their seed.default value (false unless overridden)', async () => {
    clearStore();
    const flags = await listFlags();
    flags
      .filter(f => SEED_FLAGS.some(s => s.name === f.name))
      .forEach(f => {
        const seed = SEED_FLAGS.find(s => s.name === f.name);
        const expected = seed && seed.default === true ? true : false;
        assert.equal(f.enabled, expected, f.name + ' should default to ' + expected);
      });
  });

  it('reflects setFlag changes', async () => {
    clearStore();
    await setFlag('test_customer_mode', true, 'desc');
    const flags = await listFlags();
    const f = flags.find(f => f.name === 'test_customer_mode');
    assert.ok(f, 'test_customer_mode not found in list');
    assert.equal(f.enabled, true);
  });

  it('includes KV-only flags not in SEED_FLAGS', async () => {
    clearStore();
    await setFlag('custom_flag_xyz', true, 'custom');
    const flags = await listFlags();
    assert.ok(flags.some(f => f.name === 'custom_flag_xyz'));
  });

  it('each entry has name, enabled, description fields', async () => {
    clearStore();
    const flags = await listFlags();
    flags.forEach(f => {
      assert.ok('name' in f, 'missing name');
      assert.ok('enabled' in f, 'missing enabled');
      assert.ok('description' in f, 'missing description');
    });
  });
});
