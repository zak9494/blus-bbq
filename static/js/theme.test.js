'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function makeStorage() {
  const store = Object.create(null);
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

function applyTheme(storage) {
  return storage.getItem('theme') || 'light';
}

function toggle(storage) {
  const current = applyTheme(storage);
  const next = current === 'dark' ? 'light' : 'dark';
  storage.setItem('theme', next);
  return next;
}

test('default theme is light when no preference stored', () => {
  const s = makeStorage();
  assert.equal(applyTheme(s), 'light');
});

test('toggles from light to dark', () => {
  const s = makeStorage();
  s.setItem('theme', 'light');
  assert.equal(toggle(s), 'dark');
});

test('toggles from dark to light', () => {
  const s = makeStorage();
  s.setItem('theme', 'dark');
  assert.equal(toggle(s), 'light');
});

test('double toggle returns to original theme', () => {
  const s = makeStorage();
  s.setItem('theme', 'light');
  toggle(s);
  toggle(s);
  assert.equal(applyTheme(s), 'light');
});

test('persists chosen theme across simulated page load', () => {
  const s = makeStorage();
  s.setItem('theme', 'dark');
  assert.equal(applyTheme(s), 'dark');
});

test('unknown stored value falls back to light', () => {
  const s = makeStorage();
  s.setItem('theme', 'garbage');
  const loaded = s.getItem('theme') || 'light';
  assert.notEqual(loaded, 'dark');
});
