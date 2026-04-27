/* Unit tests for api/_lib/db.js — verifies graceful behavior when
   POSTGRES_URL is missing (the Phase 1 default state). */
'use strict';
const test   = require('node:test');
const assert = require('node:assert');

// Snapshot + clear env vars BEFORE require, since db.js reads them lazily
// inside init() but pg.Pool may eagerly connect at construction time.
const snapshot = {
  POSTGRES_URL:             process.env.POSTGRES_URL,
  POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
};
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_URL_NON_POOLING;

const db = require('./db.js');

test.after(() => {
  // Restore so we don't leak into other tests in the same node --test run.
  if (snapshot.POSTGRES_URL !== undefined) process.env.POSTGRES_URL = snapshot.POSTGRES_URL;
  if (snapshot.POSTGRES_URL_NON_POOLING !== undefined) {
    process.env.POSTGRES_URL_NON_POOLING = snapshot.POSTGRES_URL_NON_POOLING;
  }
});

test('isAvailable() returns false without POSTGRES_URL', () => {
  assert.strictEqual(db.isAvailable(), false);
});

test('getPool() returns null without POSTGRES_URL', () => {
  assert.strictEqual(db.getPool(), null);
});

test('getDirectPool() returns null without POSTGRES_URL_NON_POOLING', () => {
  assert.strictEqual(db.getDirectPool(), null);
});

test('query() throws a clear "not configured" error when unavailable', async () => {
  await assert.rejects(
    () => db.query('SELECT 1'),
    /Postgres not configured/
  );
});

test('withClient() throws "not configured" error when unavailable', async () => {
  await assert.rejects(
    () => db.withClient(async () => 1),
    /Postgres not configured/
  );
});

test('exports the expected surface', () => {
  assert.strictEqual(typeof db.getPool, 'function');
  assert.strictEqual(typeof db.getDirectPool, 'function');
  assert.strictEqual(typeof db.isAvailable, 'function');
  assert.strictEqual(typeof db.query, 'function');
  assert.strictEqual(typeof db.withClient, 'function');
});
