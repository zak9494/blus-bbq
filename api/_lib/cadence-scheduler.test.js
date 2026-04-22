'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// getNextFollowUpMs is pure — no KV or network; import directly
const { getNextFollowUpMs } = require('./cadence-scheduler.js');

const MS  = 1;
const SEC = 1000;
const MIN = 60 * SEC;
const DAY = 24 * 60 * MIN;

// Convenience: build nowMs and an event date that is `days` calendar days away
function setup(days) {
  const nowMs   = Date.now();
  // Set event_date to midnight `days` days from now to give a clean ceiling
  const eventMs = nowMs + days * DAY;
  const inq     = { event_date: new Date(eventMs).toISOString() };
  return { nowMs, inq, eventMs };
}

describe('getNextFollowUpMs — cadence rules', () => {

  it('returns null when event_date is missing', () => {
    assert.equal(getNextFollowUpMs({}), null);
    assert.equal(getNextFollowUpMs(null), null);
  });

  it('returns null when event_date is unparseable', () => {
    assert.equal(getNextFollowUpMs({ event_date: 'not-a-date' }), null);
  });

  it('returns null when event is today (already past nowMs)', () => {
    const nowMs = Date.now();
    // event in 0 ms → not strictly in the future
    const inq = { event_date: new Date(nowMs).toISOString() };
    assert.equal(getNextFollowUpMs(inq, nowMs), null);
  });

  it('returns null when event is in the past', () => {
    const nowMs = Date.now();
    const inq   = { event_date: new Date(nowMs - DAY).toISOString() };
    assert.equal(getNextFollowUpMs(inq, nowMs), null);
  });

  it('event in 1 day → follow up in 1 day (≤3 rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 1 * DAY + MIN; // slight buffer so it's strictly future
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    assert.ok(next, 'should return a timestamp');
    const diff = next - nowMs;
    assert.ok(diff >= DAY - MIN && diff <= DAY + MIN, 'diff should be ~1 day, got ' + diff);
  });

  it('event in 3 days → follow up in 1 day (≤3 rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 3 * DAY + MIN;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= DAY - MIN && diff <= DAY + MIN, 'diff should be ~1 day');
  });

  it('event in 4 days → follow up in 2 days (4–7 rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 4 * DAY + MIN;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= 2 * DAY - MIN && diff <= 2 * DAY + MIN, 'diff should be ~2 days');
  });

  it('event in 7 days → follow up in 2 days (4–7 rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 7 * DAY + MIN;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= 2 * DAY - MIN && diff <= 2 * DAY + MIN, 'diff should be ~2 days');
  });

  it('event in 8 days → follow up in 7 days (8–21 rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 8 * DAY + MIN;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= 7 * DAY - MIN && diff <= 7 * DAY + MIN, 'diff should be ~7 days');
  });

  it('event in 21 days → follow up in 7 days (8–21 rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 21 * DAY + MIN;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= 7 * DAY - MIN && diff <= 7 * DAY + MIN, 'diff should be ~7 days');
  });

  it('event in 22 days, no prior follow-up → 4 days (22+ first-time rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 22 * DAY + MIN;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= 4 * DAY - MIN && diff <= 4 * DAY + MIN, 'diff should be ~4 days');
  });

  it('event in 22 days, with prior follow-up → 7 days (22+ subsequent rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 22 * DAY + MIN;
    const inq     = {
      event_date:       new Date(eventMs).toISOString(),
      last_follow_up_at: new Date(nowMs - DAY).toISOString(),
    };
    const next = getNextFollowUpMs(inq, nowMs);
    const diff = next - nowMs;
    assert.ok(diff >= 7 * DAY - MIN && diff <= 7 * DAY + MIN, 'diff should be ~7 days');
  });

  it('event in 100 days, no prior follow-up → 4 days (22+ first-time rule)', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 100 * DAY;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    const diff    = next - nowMs;
    assert.ok(diff >= 4 * DAY - MIN && diff <= 4 * DAY + MIN, 'diff should be ~4 days for 100-day event');
  });

  it('event in 100 days, with prior follow-up → 7 days', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 100 * DAY;
    const inq     = {
      event_date:       new Date(eventMs).toISOString(),
      last_follow_up_at: new Date(nowMs - 7 * DAY).toISOString(),
    };
    const next = getNextFollowUpMs(inq, nowMs);
    const diff = next - nowMs;
    assert.ok(diff >= 7 * DAY - MIN && diff <= 7 * DAY + MIN, 'diff should be ~7 days for 100-day event with prior');
  });

  it('uses email_date as fallback when event_date is absent', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 5 * DAY + MIN;
    const inq     = { email_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    assert.ok(next, 'should return a timestamp using email_date');
    const diff = next - nowMs;
    assert.ok(diff >= 2 * DAY - MIN && diff <= 2 * DAY + MIN, 'diff should be ~2 days (4–7 rule)');
  });

  it('next timestamp is strictly in the future', () => {
    const nowMs   = Date.now();
    const eventMs = nowMs + 10 * DAY;
    const inq     = { event_date: new Date(eventMs).toISOString() };
    const next    = getNextFollowUpMs(inq, nowMs);
    assert.ok(next > nowMs, 'next follow-up must be after now');
  });
});
