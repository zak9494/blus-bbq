'use strict';

// scripts/runbooks.test.js
// Validates that every runbook in docs/runbooks/ follows the standard shape,
// so the index doesn't drift from the docs and so future runbooks copy the
// pattern instead of inventing new section names.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'docs', 'runbooks');

const REQUIRED_SECTIONS = [
  '## Symptoms',
  '## Immediate action',
  '## Diagnose',
  '## Root cause checklist',
  '## Fix',
  '## Verify',
  '## Post-incident',
];

const runbookFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.md') && f !== 'README.md');

test('runbooks/ has at least 8 playbooks (post-merge-smoke, vercel, secret, customer-profile, parallel-branch, pr-stuck, calendar, notifications)', () => {
  assert.ok(runbookFiles.length >= 8, `expected >= 8 runbooks, found ${runbookFiles.length}`);
  for (const expected of [
    'post-merge-smoke-failed.md',
    'vercel-deploy-failed.md',
    'secret-rotation.md',
    'customer-profile-v2-flag.md',
    'parallel-branch-contention.md',
    'pr-stuck-in-bucket.md',
    'calendar-shows-wrong-events.md',
    'notifications-page-broken.md',
  ]) {
    assert.ok(runbookFiles.includes(expected), `missing runbook: ${expected}`);
  }
});

test('every runbook has the standard sections', () => {
  for (const f of runbookFiles) {
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(
        body.includes(section),
        `${f} missing section "${section}" — see docs/runbooks/README.md for the template`
      );
    }
  }
});

test('every runbook starts with "# Runbook:"', () => {
  for (const f of runbookFiles) {
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    const firstLine = body.split('\n', 1)[0];
    assert.match(firstLine, /^# Runbook:/, `${f} first line must start with "# Runbook:"`);
  }
});

test('runbooks/README.md indexes every runbook', () => {
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  for (const f of runbookFiles) {
    assert.ok(readme.includes(f), `runbooks/README.md does not link to ${f}`);
  }
});
