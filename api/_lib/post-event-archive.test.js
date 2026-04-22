'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { yesterdayCT } = require('./post-event-archive.js');

describe('yesterdayCT', () => {
  it('returns a YYYY-MM-DD string', () => {
    const d = yesterdayCT();
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('is strictly earlier than today UTC', () => {
    const d = yesterdayCT();
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(d < today, 'yesterdayCT should be before today: ' + d + ' vs ' + today);
  });

  it('returns consistent results on repeated calls', () => {
    const a = yesterdayCT();
    const b = yesterdayCT();
    assert.equal(a, b);
  });
});

describe('runPostEventArchive (dry run — no KV needed)', () => {
  it('dry_run skips writes and returns summary shape', async () => {
    // We test the dry_run path which counts without writing.
    // Use process.env trick: point KV at a known-empty mock that returns empty index.
    const origUrl = process.env.KV_REST_API_URL;
    const origTok = process.env.KV_REST_API_TOKEN;
    process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
    process.env.KV_REST_API_TOKEN = 'mock-token';

    const https = require('https');
    const _orig = https.request;

    // Mock KV to return empty index
    https.request = function(opts, cb) {
      const bodyChunks = [];
      const res = {
        statusCode: 200,
        on(ev, h) { if (ev === 'data') res._d = h; if (ev === 'end') res._e = h; return res; },
        resume() { return res; },
      };
      const req = {
        write(c) { bodyChunks.push(c); },
        end() {
          const responseBody = JSON.stringify({ result: JSON.stringify([]) });
          if (cb) cb(res);
          if (res._d) res._d(responseBody);
          if (res._e) res._e();
        },
        on() { return req; },
      };
      return req;
    };

    const { runPostEventArchive } = require('./post-event-archive.js');
    const result = await runPostEventArchive({ dryRun: true });

    assert.ok('ok' in result, 'result should have ok field');
    assert.ok('scanned' in result, 'result should have scanned field');
    assert.ok('archived' in result, 'result should have archived field');
    assert.ok('errors' in result, 'result should have errors field');
    assert.ok(Array.isArray(result.errors), 'errors should be array');

    https.request = _orig;
    process.env.KV_REST_API_URL   = origUrl;
    process.env.KV_REST_API_TOKEN = origTok;
  });
});
