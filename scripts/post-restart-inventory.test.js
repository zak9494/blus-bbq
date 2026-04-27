'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, statSync } = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'post-restart-inventory.sh');

describe('scripts/post-restart-inventory.sh', () => {
  it('exists and is executable', () => {
    assert.ok(existsSync(SCRIPT), `${SCRIPT} not found`);
    const mode = statSync(SCRIPT).mode;
    // owner-execute bit
    assert.ok((mode & 0o100) !== 0, 'script is not owner-executable');
  });

  it('exits 0 on the current tree (read-only, idempotent)', () => {
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(
      result.status,
      0,
      `non-zero exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    // sanity: it printed *something* — header line is stable.
    assert.match(result.stdout, /=== Post-restart inventory ===/);
  });

  it('is idempotent — second run also exits 0 with same shape', () => {
    const a = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 30_000 });
    const b = spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    // Section headers should match between runs (timestamps and PR-age values
    // will differ; comparing headers only proves the structure is stable).
    const headers = (s) => s.match(/^---.*---$/gm) || [];
    assert.deepEqual(headers(a.stdout), headers(b.stdout));
  });
});
