/* ===== TEST: api/calendar/list.js — buildInquiryEvents merges KV inquiries
   The calendar page only ever fetched Google Calendar events, so any booking
   that lived in inquiries:* (the common case for catering ops) silently
   disappeared from the grid. These tests pin the synthetic-event behavior:
   in-window inquiries become events; archived/declined/lost are skipped;
   inquiries with a thread already on Google Calendar are de-duplicated.
   ===== */
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { _buildInquiryEvents } = require('./list.js');

const APR_MIN = new Date(2026, 3, 1).toISOString();          // April 2026
const APR_MAX = new Date(2026, 4, 0, 23, 59, 59).toISOString();

function inq(over) {
  return Object.assign({
    threadId: 't' + Math.random().toString(36).slice(2, 8),
    customer_name: 'Test Customer',
    event_date: '2026-04-15',
    status: 'quote_drafted',
  }, over);
}

describe('buildInquiryEvents — synthetic events from KV inquiries', () => {
  test('emits an event for each in-window inquiry with event_date', () => {
    const events = _buildInquiryEvents([
      inq({ threadId: 'a', event_date: '2026-04-14', customer_name: 'Susan' }),
      inq({ threadId: 'b', event_date: '2026-04-26', customer_name: 'Bob' }),
    ], APR_MIN, APR_MAX, new Set());
    assert.equal(events.length, 2);
    assert.equal(events[0].id, 'inq:a');
    assert.equal(events[0].summary, 'Susan');
    assert.equal(events[0].start.date, '2026-04-14');
    assert.equal(events[0].end.date, '2026-04-15');
    assert.equal(events[0].extendedProperties.private.blusBbqThreadId, 'a');
    assert.equal(events[0].bbqVirtual, true);
  });

  test('skips inquiries outside the time window', () => {
    const events = _buildInquiryEvents([
      inq({ threadId: 'mar', event_date: '2026-03-31' }),
      inq({ threadId: 'apr', event_date: '2026-04-15' }),
      inq({ threadId: 'may', event_date: '2026-05-01' }),
    ], APR_MIN, APR_MAX, new Set());
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'inq:apr');
  });

  test('skips archived, declined, and lost inquiries', () => {
    const events = _buildInquiryEvents([
      inq({ threadId: 'arc', status: 'archived' }),
      inq({ threadId: 'dec', status: 'declined' }),
      inq({ threadId: 'lost', status: 'quote_drafted', lost_at: '2026-04-10T00:00:00Z' }),
      inq({ threadId: 'ok',  status: 'quote_drafted' }),
    ], APR_MIN, APR_MAX, new Set());
    assert.deepEqual(events.map(e => e.id), ['inq:ok']);
  });

  test('skips inquiries with no event_date or no threadId', () => {
    const events = _buildInquiryEvents([
      inq({ threadId: '',  event_date: '2026-04-15' }),
      inq({ threadId: 'x', event_date: null }),
      inq({ threadId: 'y', event_date: '2026-04-15' }),
    ], APR_MIN, APR_MAX, new Set());
    assert.deepEqual(events.map(e => e.id), ['inq:y']);
  });

  test('skips inquiries already represented by a Google Calendar event (de-dup)', () => {
    const events = _buildInquiryEvents([
      inq({ threadId: 'taken', event_date: '2026-04-15' }),
      inq({ threadId: 'fresh', event_date: '2026-04-15' }),
    ], APR_MIN, APR_MAX, new Set(['taken']));
    assert.deepEqual(events.map(e => e.id), ['inq:fresh']);
  });

  test('falls back to from / subject when customer_name is empty', () => {
    const events = _buildInquiryEvents([
      inq({ threadId: 'a', customer_name: null, from: 'Foo <foo@bar>', subject: 'BBQ Party' }),
      inq({ threadId: 'b', customer_name: null, from: null,            subject: 'Inquiry Z' }),
    ], APR_MIN, APR_MAX, new Set());
    assert.equal(events[0].summary, 'Foo <foo@bar>');
    assert.equal(events[1].summary, 'Inquiry Z');
  });

  test('handles empty / null input safely', () => {
    assert.deepEqual(_buildInquiryEvents(null, APR_MIN, APR_MAX, new Set()), []);
    assert.deepEqual(_buildInquiryEvents([], APR_MIN, APR_MAX, new Set()), []);
    assert.deepEqual(_buildInquiryEvents([{ threadId: 'x' }], APR_MIN, APR_MAX, new Set()), []);
  });
});
