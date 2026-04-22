'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
process.env.KV_REST_API_TOKEN = 'mock-token';

// ── KV mock (supports GET, pipeline SET/GET/ZADD/ZREM/ZREVRANGE) ─────────────
const https = require('https');
const _kv    = {};
const _zsets = {};

function clearStore() {
  Object.keys(_kv).forEach(k => delete _kv[k]);
  Object.keys(_zsets).forEach(k => delete _zsets[k]);
}

function execCmd(cmd) {
  const [op, ...args] = cmd;
  switch (op) {
    case 'SET':  _kv[args[0]] = args[1]; return { result: 'OK' };
    case 'GET':  return { result: Object.prototype.hasOwnProperty.call(_kv, args[0]) ? _kv[args[0]] : null };
    case 'ZADD': {
      if (!_zsets[args[0]]) _zsets[args[0]] = new Map();
      _zsets[args[0]].set(args[2], Number(args[1]));
      return { result: 1 };
    }
    case 'ZREM': {
      const existed = _zsets[args[0]] && _zsets[args[0]].has(args[1]);
      if (_zsets[args[0]]) _zsets[args[0]].delete(args[1]);
      return { result: existed ? 1 : 0 };
    }
    case 'ZREVRANGE': {
      if (!_zsets[args[0]]) return { result: [] };
      const sorted = [..._zsets[args[0]].entries()]
        .sort((a, b) => b[1] - a[1]).map(([m]) => m);
      const s = parseInt(args[1], 10);
      const e = (args[2] === -1 || args[2] === '-1') ? sorted.length : parseInt(args[2], 10) + 1;
      return { result: sorted.slice(s, e) };
    }
    default: return { result: null };
  }
}

https.request = function mockRequest(opts, cb) {
  const path   = typeof opts === 'string' ? opts : (opts.path || '');
  const method = typeof opts === 'object' ? (opts.method || 'GET') : 'GET';
  const bodyChunks = [];

  const res = {
    statusCode: 200,
    on(ev, h) {
      if (ev === 'data') res._data = h;
      if (ev === 'end')  res._end  = h;
      return res;
    },
    resume() { return res; },
  };

  const req = {
    write(c) { bodyChunks.push(c); },
    end() {
      let responseBody;
      if (method === 'GET') {
        const m = path.match(/\/get\/([^?]+)/);
        const key = m ? decodeURIComponent(m[1]) : '';
        responseBody = JSON.stringify({ result: _kv[key] || null });
      } else {
        let cmds = [];
        try { cmds = JSON.parse(bodyChunks.join('')); } catch { cmds = []; }
        const results = cmds.map(c => execCmd(c));
        responseBody = JSON.stringify(results);
      }
      if (cb) cb(res);
      if (res._data) res._data(responseBody);
      if (res._end)  res._end();
    },
    on() { return req; },
  };
  return req;
};

const { enqueueSuggestion, listPending, approve, reject, getStats } = require('./quote-update-queue.js');

const SAMPLE_SUGGESTION = {
  changes: [
    { field: 'guest_count', oldValue: '50', newValue: '75', confidence: 0.9, reason: 'Customer explicitly asked for 75' },
  ],
  summary: 'Customer wants to increase guest count from 50 to 75',
};

const SAMPLE_INQUIRY = {
  threadId: 'test-thread-001',
  status: 'quote_sent',
  extracted_fields: { customer_name: 'Alice Smith', guest_count: '50', event_date: '2026-08-01' },
  quote: { total: 2500, line_items: [] },
  activity_log: [],
};

beforeEach(clearStore);

describe('enqueueSuggestion', () => {
  it('returns a record with correct shape', async () => {
    const rec = await enqueueSuggestion({ inquiryId: 'thread-1', suggestion: SAMPLE_SUGGESTION });
    assert.ok(rec.id.startsWith('qupd_'));
    assert.equal(rec.inquiryId, 'thread-1');
    assert.equal(rec.status, 'pending');
    assert.ok(rec.createdAt);
    assert.equal(rec.suggestion, SAMPLE_SUGGESTION);
  });

  it('throws if inquiryId is missing', async () => {
    await assert.rejects(
      () => enqueueSuggestion({ suggestion: SAMPLE_SUGGESTION }),
      /inquiryId is required/
    );
  });

  it('throws if suggestion.changes is not an array', async () => {
    await assert.rejects(
      () => enqueueSuggestion({ inquiryId: 'x', suggestion: { summary: 'bad' } }),
      /changes must be an array/
    );
  });
});

describe('listPending', () => {
  it('returns empty array when queue is empty', async () => {
    const items = await listPending();
    assert.deepEqual(items, []);
  });

  it('returns only pending items', async () => {
    await enqueueSuggestion({ inquiryId: 'thread-A', suggestion: SAMPLE_SUGGESTION });
    await enqueueSuggestion({ inquiryId: 'thread-B', suggestion: SAMPLE_SUGGESTION });
    const items = await listPending();
    assert.equal(items.length, 2);
    items.forEach(i => assert.equal(i.status, 'pending'));
  });
});

describe('reject', () => {
  it('marks item as rejected with reason', async () => {
    const rec = await enqueueSuggestion({ inquiryId: 'thread-R', suggestion: SAMPLE_SUGGESTION });
    const result = await reject(rec.id, 'Not applicable');
    assert.equal(result.ok, true);
    assert.equal(result.item.status, 'rejected');
    assert.equal(result.item.rejectReason, 'Not applicable');
    assert.ok(result.item.resolvedAt);
  });

  it('removes rejected item from listPending', async () => {
    const rec = await enqueueSuggestion({ inquiryId: 'thread-R2', suggestion: SAMPLE_SUGGESTION });
    await reject(rec.id, 'out of scope');
    const pending = await listPending();
    assert.ok(!pending.some(i => i.id === rec.id));
  });

  it('throws if item not found', async () => {
    await assert.rejects(() => reject('nonexistent_id'), /not found/);
  });

  it('throws if item is not pending', async () => {
    const rec = await enqueueSuggestion({ inquiryId: 'thread-R3', suggestion: SAMPLE_SUGGESTION });
    await reject(rec.id, 'first reject');
    await assert.rejects(() => reject(rec.id, 'second reject'), /not pending/);
  });
});

describe('approve', () => {
  it('applies extracted_field changes to inquiry', async () => {
    // Seed the inquiry in the mock store
    _kv['inquiries:test-thread-001'] = JSON.stringify(SAMPLE_INQUIRY);
    const rec = await enqueueSuggestion({ inquiryId: 'test-thread-001', suggestion: SAMPLE_SUGGESTION });
    const result = await approve(rec.id);
    assert.equal(result.ok, true);
    assert.ok(result.applied.includes('guest_count'));

    // Verify the inquiry was updated in the store
    const updatedRaw = _kv['inquiries:test-thread-001'];
    const updated = JSON.parse(updatedRaw);
    assert.equal(updated.extracted_fields.guest_count, '75');
  });

  it('marks item as approved', async () => {
    _kv['inquiries:test-thread-001'] = JSON.stringify(SAMPLE_INQUIRY);
    const rec = await enqueueSuggestion({ inquiryId: 'test-thread-001', suggestion: SAMPLE_SUGGESTION });
    const result = await approve(rec.id);
    assert.equal(result.item.status, 'approved');
  });

  it('throws if inquiry not found', async () => {
    const rec = await enqueueSuggestion({ inquiryId: 'missing-inquiry', suggestion: SAMPLE_SUGGESTION });
    await assert.rejects(() => approve(rec.id), /Inquiry not found/);
  });

  it('appends activity log entry', async () => {
    _kv['inquiries:test-thread-001'] = JSON.stringify(SAMPLE_INQUIRY);
    const rec = await enqueueSuggestion({ inquiryId: 'test-thread-001', suggestion: SAMPLE_SUGGESTION });
    await approve(rec.id);
    const updated = JSON.parse(_kv['inquiries:test-thread-001']);
    const logEntry = updated.activity_log.find(e => e.type === 'quote_update_approved');
    assert.ok(logEntry, 'activity log entry should be added');
  });
});

describe('getStats', () => {
  it('returns zero counts when queue is empty', async () => {
    const stats = await getStats();
    assert.equal(stats.total, 0);
    assert.equal(stats.pending, 0);
  });

  it('counts pending, approved, rejected correctly', async () => {
    _kv['inquiries:test-thread-001'] = JSON.stringify(SAMPLE_INQUIRY);
    const r1 = await enqueueSuggestion({ inquiryId: 'test-thread-001', suggestion: SAMPLE_SUGGESTION });
    const r2 = await enqueueSuggestion({ inquiryId: 'test-thread-001', suggestion: SAMPLE_SUGGESTION });
    await reject(r1.id, 'no');
    _kv['inquiries:test-thread-001'] = JSON.stringify(SAMPLE_INQUIRY); // reset for approve
    const stats = await getStats();
    assert.equal(stats.pending, 1);
    assert.equal(stats.rejected, 1);
    assert.equal(stats.total, 2);
  });
});
