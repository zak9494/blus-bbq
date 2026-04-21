'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inqEventDateInRange, isNeedsReview } = require('./inquiries-filters.js');

// Fixed reference date: Wednesday 2026-04-22 (local)
// Week (Mon–Sun): 2026-04-20 … 2026-04-26
// Last week:      2026-04-13 … 2026-04-19
const NOW = new Date(2026, 3, 22); // month is 0-indexed

function inq(dateStr) {
  return { email_date: dateStr };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function localISO(y, m, d) {
  // returns an ISO-like string that new Date() will parse as local time
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00`;
}

describe('inqEventDateInRange', () => {
  describe('all', () => {
    it('always returns true', () => {
      assert.ok(inqEventDateInRange('all', inq(localISO(2020, 1, 1)), NOW));
      assert.ok(inqEventDateInRange('all', {}, NOW));
    });
  });

  describe('today', () => {
    it('matches today', () => {
      assert.ok(inqEventDateInRange('today', inq(localISO(2026, 4, 22)), NOW));
    });
    it('rejects yesterday', () => {
      assert.ok(!inqEventDateInRange('today', inq(localISO(2026, 4, 21)), NOW));
    });
    it('rejects tomorrow', () => {
      assert.ok(!inqEventDateInRange('today', inq(localISO(2026, 4, 23)), NOW));
    });
    it('returns true when no timestamp', () => {
      assert.ok(inqEventDateInRange('today', {}, NOW));
    });
    it('returns true for unparseable timestamp', () => {
      assert.ok(inqEventDateInRange('today', inq('not-a-date'), NOW));
    });
  });

  describe('week (Mon–Sun containing NOW)', () => {
    it('matches Monday of current week', () => {
      assert.ok(inqEventDateInRange('week', inq(localISO(2026, 4, 20)), NOW));
    });
    it('matches NOW itself', () => {
      assert.ok(inqEventDateInRange('week', inq(localISO(2026, 4, 22)), NOW));
    });
    it('matches Sunday of current week', () => {
      assert.ok(inqEventDateInRange('week', inq(localISO(2026, 4, 26)), NOW));
    });
    it('rejects Sunday before this week', () => {
      assert.ok(!inqEventDateInRange('week', inq(localISO(2026, 4, 19)), NOW));
    });
    it('rejects Monday after this week', () => {
      assert.ok(!inqEventDateInRange('week', inq(localISO(2026, 4, 27)), NOW));
    });
  });

  describe('last-week', () => {
    it('matches first day of last week (Mon 2026-04-13)', () => {
      assert.ok(inqEventDateInRange('last-week', inq(localISO(2026, 4, 13)), NOW));
    });
    it('matches last day of last week (Sun 2026-04-19)', () => {
      assert.ok(inqEventDateInRange('last-week', inq(localISO(2026, 4, 19)), NOW));
    });
    it('rejects current week Monday', () => {
      assert.ok(!inqEventDateInRange('last-week', inq(localISO(2026, 4, 20)), NOW));
    });
    it('rejects two weeks ago', () => {
      assert.ok(!inqEventDateInRange('last-week', inq(localISO(2026, 4, 12)), NOW));
    });
  });

  describe('month', () => {
    it('matches same month', () => {
      assert.ok(inqEventDateInRange('month', inq(localISO(2026, 4, 1)), NOW));
    });
    it('rejects previous month', () => {
      assert.ok(!inqEventDateInRange('month', inq(localISO(2026, 3, 30)), NOW));
    });
    it('rejects next month', () => {
      assert.ok(!inqEventDateInRange('month', inq(localISO(2026, 5, 1)), NOW));
    });
  });

  describe('custom', () => {
    const start = new Date(2026, 3, 10); // 2026-04-10
    const end   = new Date(2026, 3, 15); // 2026-04-15

    it('matches date within range', () => {
      assert.ok(inqEventDateInRange('custom', inq(localISO(2026, 4, 12)), NOW, start, end));
    });
    it('matches start boundary', () => {
      assert.ok(inqEventDateInRange('custom', inq(localISO(2026, 4, 10)), NOW, start, end));
    });
    it('matches end boundary', () => {
      assert.ok(inqEventDateInRange('custom', inq(localISO(2026, 4, 15)), NOW, start, end));
    });
    it('rejects before start', () => {
      assert.ok(!inqEventDateInRange('custom', inq(localISO(2026, 4, 9)), NOW, start, end));
    });
    it('rejects after end', () => {
      assert.ok(!inqEventDateInRange('custom', inq(localISO(2026, 4, 16)), NOW, start, end));
    });
    it('returns true when no start or end set', () => {
      assert.ok(inqEventDateInRange('custom', inq(localISO(2026, 4, 1)), NOW, null, null));
    });
    it('open-ended start only', () => {
      assert.ok(inqEventDateInRange('custom', inq(localISO(2026, 4, 20)), NOW, start, null));
      assert.ok(!inqEventDateInRange('custom', inq(localISO(2026, 4, 9)), NOW, start, null));
    });
  });

  describe('unknown filter', () => {
    it('returns true as fallback', () => {
      assert.ok(inqEventDateInRange('nonexistent', inq(localISO(2026, 1, 1)), NOW));
    });
  });
});

describe('isNeedsReview', () => {
  it('true when not archived and not approved', () => {
    assert.ok(isNeedsReview({ status: 'new', approved: false }));
  });
  it('true when status is undefined and not approved', () => {
    assert.ok(isNeedsReview({ approved: false }));
  });
  it('false when archived', () => {
    assert.ok(!isNeedsReview({ status: 'archived', approved: false }));
  });
  it('false when approved', () => {
    assert.ok(!isNeedsReview({ status: 'new', approved: true }));
  });
  it('false when archived and approved', () => {
    assert.ok(!isNeedsReview({ status: 'archived', approved: true }));
  });
});
