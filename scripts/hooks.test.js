// scripts/hooks.test.js
// Validates the husky + lint-staged + ESLint + Prettier wiring.
// Catches regressions like: someone deletes .husky/pre-commit, lint-staged config
// disappears from package.json, or husky/lint-staged are removed from devDependencies.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('husky pre-commit hook file exists', () => {
  const p = path.join(root, '.husky', 'pre-commit');
  assert.ok(fs.existsSync(p), '.husky/pre-commit must exist');
  const body = fs.readFileSync(p, 'utf8');
  assert.match(body, /lint-staged/, 'pre-commit must call lint-staged');
  assert.match(body, /scripts\/lint\.js/, 'pre-commit must guard index.html JS syntax');
  assert.match(body, /npm test/, 'pre-commit must run unit tests');
});

test('package.json declares husky, lint-staged, eslint, prettier', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const dep of ['husky', 'lint-staged', 'eslint', 'prettier']) {
    assert.ok(pkg.devDependencies[dep], `devDependencies must include ${dep}`);
  }
  assert.equal(pkg.scripts.prepare, 'husky', 'scripts.prepare must run husky');
  assert.ok(pkg['lint-staged'], 'package.json must define a lint-staged config');
  const ls = pkg['lint-staged'];
  const jsKey = Object.keys(ls).find((k) => k.includes('*.js'));
  assert.ok(jsKey, 'lint-staged must have a *.js rule');
  const jsCmds = ls[jsKey].join(' ');
  assert.match(jsCmds, /eslint/, 'lint-staged *.js rule must run eslint');
  assert.match(jsCmds, /prettier/, 'lint-staged *.js rule must run prettier');
});

test('eslint and prettier configs exist', () => {
  assert.ok(
    fs.existsSync(path.join(root, 'eslint.config.js')),
    'eslint.config.js (flat config) must exist at repo root — ESLint v9+ requires it'
  );
  assert.ok(
    fs.existsSync(path.join(root, '.prettierrc.json')),
    '.prettierrc.json must exist at repo root'
  );
  assert.ok(
    fs.existsSync(path.join(root, '.prettierignore')),
    '.prettierignore must exist (keeps index.html and node_modules out of prettier)'
  );
});

test('.prettierignore excludes index.html (avoid 91KB reformat diffs)', () => {
  const body = fs.readFileSync(path.join(root, '.prettierignore'), 'utf8');
  assert.match(body, /^index\.html$/m, '.prettierignore must list index.html on its own line');
  assert.match(body, /node_modules/, '.prettierignore must list node_modules');
});
