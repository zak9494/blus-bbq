'use strict';

// scripts/commitlint.test.js
// Validates the conventional-commits + changelog wiring:
// - commitlint.config.js loads, extends config-conventional
// - .husky/commit-msg invokes commitlint
// - package.json declares the release scripts and required devDeps
// - CHANGELOG.md exists

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('commitlint.config.js loads and extends config-conventional', () => {
  const cfg = require(path.join(root, 'commitlint.config.js'));
  assert.deepEqual(cfg.extends, ['@commitlint/config-conventional']);
  const types = cfg.rules['type-enum'][2];
  for (const t of ['feat', 'fix', 'hotfix', 'chore', 'docs', 'test', 'qa']) {
    assert.ok(types.includes(t), `type-enum must include "${t}"`);
  }
});

test('.husky/commit-msg invokes commitlint', () => {
  const p = path.join(root, '.husky', 'commit-msg');
  assert.ok(fs.existsSync(p), '.husky/commit-msg must exist');
  const body = fs.readFileSync(p, 'utf8');
  assert.match(body, /commitlint/, 'commit-msg hook must call commitlint');
  assert.match(body, /--edit\s+"\$1"/, 'commit-msg hook must pass $1 via --edit');
});

test('package.json declares commitlint deps and release scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const dep of [
    '@commitlint/cli',
    '@commitlint/config-conventional',
    'husky',
    'standard-version',
  ]) {
    assert.ok(pkg.devDependencies[dep], `devDependencies must include ${dep}`);
  }
  assert.ok(pkg.scripts.release, 'scripts.release must be defined');
  assert.match(pkg.scripts.release, /standard-version/);
});

test('CHANGELOG.md exists at repo root', () => {
  assert.ok(
    fs.existsSync(path.join(root, 'CHANGELOG.md')),
    'CHANGELOG.md must exist (standard-version writes here)'
  );
});
