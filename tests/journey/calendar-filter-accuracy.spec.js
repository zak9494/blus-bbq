// @ts-check
// Adversarial verification — calendar status chip filter ACCURACY
//
// PR #83 fixed events not rendering on the calendar grid, but the chip filter
// itself had three bugs that PR #64 / PR #83 did not catch:
//   1. force-1 chip — last active chip could not be deselected
//   2. unlinked Google Calendar events bypassed the filter entirely
//   3. inquiries with status `quote_approved` / `new` had no chip and were
//      always hidden (even with all chips ON)
//
// This spec asserts: for every chip combination (single, multi, all, none),
// the rendered events exactly match the chips' selected statuses, with
// `quote_approved` collapsed into the Quote Sent chip and unlinked events
// collapsed into the Booked chip.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-calendar-filter-accuracy');
fs.mkdirSync(OUT, { recursive: true });

// Always serve the locally-patched calendar.js so this test verifies the fix
// even when BASE_URL points at a deploy that lacks it.
const LOCAL_CALENDAR_JS = fs.readFileSync(
  path.join(__dirname, '../../static/js/calendar.js'), 'utf8');

const STATUSES = {
  'thread-needs':    'needs_info',
  'thread-drafted':  'quote_drafted',
  'thread-sent':     'quote_sent',
  'thread-approved': 'quote_approved', // no dedicated chip → folded into Quote Sent
  'thread-booked':   'booked',
  'thread-completed':'completed',
  // 'thread-unlinked' has no inquiry → folded into Booked
};

function makeEvents() {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  function day(d, t) { return `${y}-${m}-${String(d).padStart(2,'0')}T${t}-05:00`; }
  function ev(id, name, dom, tid) {
    const e = {
      id,
      summary: name,
      start: { dateTime: day(dom, '12:00:00') },
      end:   { dateTime: day(dom, '15:00:00') },
    };
    if (tid) e.extendedProperties = { private: { blusBbqThreadId: tid } };
    return e;
  }
  return [
    ev('e-needs',    'Alice Needs',    7,  'thread-needs'),
    ev('e-drafted',  'Bob Drafted',    8,  'thread-drafted'),
    ev('e-sent',     'Carol Sent',     9,  'thread-sent'),
    ev('e-approved', 'Dan Approved',   10, 'thread-approved'),
    ev('e-booked',   'Eve Booked',     11, 'thread-booked'),
    ev('e-completed','Faye Completed', 14, 'thread-completed'),
    ev('e-unlinked', 'Main Auction',   15, null), // no threadId
  ];
}

async function setupMocks(page) {
  await page.route('**/static/js/calendar.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: LOCAL_CALENDAR_JS }));
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/calendar/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, events: makeEvents() }) }));
  await page.route('**/api/inquiries/get*', r => {
    const url = new URL(r.request().url());
    const tid = url.searchParams.get('threadId');
    const status = STATUSES[tid];
    if (status) {
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, inquiry: { status } }) });
    } else {
      r.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ error: 'not found' }) });
    }
  });
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [
        { name: 'nav_v2',              enabled: false, description: '' },
        { name: 'kanban_restructure',  enabled: true,  description: '' },
        { name: 'calendar_v2',         enabled: false, description: '' },
        { name: 'calendar_filters_v2', enabled: true,  description: '' },
      ] }) }));
}

async function loadCalendar(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('calendar');
    if (typeof window.calSetView === 'function') window.calSetView('month');
  });
  await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });
  await page.waitForSelector('.cal-month-view', { timeout: 10000 });
  // loadInqStatuses() resolves asynchronously per-thread; give it a beat.
  await page.waitForFunction(() => {
    return document.querySelectorAll('.cal-month-view .cal-event').length > 0;
  }, { timeout: 10000 });
}

// `target` is an array of chip labels that should end up active.
async function setChipState(page, target) {
  const labelsActive = await page.$$eval('#cal-status-chips-bar .cal-status-chip',
    (btns) => btns.map(b => ({ label: b.textContent, active: b.classList.contains('cal-status-chip-active') })));
  const targetSet = new Set(target);
  // First add anything missing, then remove anything extra — order matters
  // because the old buggy code prevented the last chip from being deselected.
  // After the fix it works either way, but we keep this order so the test
  // double-checks the new behavior under the worst sequence too.
  for (const { label, active } of labelsActive) {
    if (targetSet.has(label) && !active) {
      await page.locator('#cal-status-chips-bar .cal-status-chip', { hasText: label }).click();
    }
  }
  for (const { label, active } of labelsActive) {
    if (!targetSet.has(label) && active) {
      await page.locator('#cal-status-chips-bar .cal-status-chip', { hasText: label }).click();
    }
  }
  // Re-confirm the resulting state matches the target.
  const final = await page.$$eval('#cal-status-chips-bar .cal-status-chip-active',
    (btns) => btns.map(b => b.textContent));
  expect(new Set(final)).toEqual(new Set(target));
}

async function visibleEventNames(page) {
  return page.$$eval('.cal-month-view .cal-event:not(.cal-event-overflow)', (evs) =>
    evs.map(e => (e.querySelector('.cal-event-name') || {}).textContent));
}

const ALL = ['Needs More Info','Quote Drafted','Quote Sent','Booked','Completed'];

test.describe('calendar filter accuracy — chip state determines rendered events', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await loadCalendar(page);
  });

  test('default state (Booked + Completed) shows booked + completed + unlinked GCal events', async ({ page }) => {
    // The page bootstrap leaves Booked + Completed active. Unlinked GCal
    // events ("Main Auction") are folded into Booked, so they appear too.
    const names = await visibleEventNames(page);
    expect(new Set(names)).toEqual(new Set(['Eve Booked', 'Faye Completed', 'Main Auction']));
    await page.screenshot({ path: `${OUT}/default.png` });
  });

  test('all chips ON shows every event including quote_approved and unlinked', async ({ page }) => {
    await setChipState(page, ALL);
    const names = await visibleEventNames(page);
    expect(new Set(names)).toEqual(new Set([
      'Alice Needs', 'Bob Drafted', 'Carol Sent', 'Dan Approved',
      'Eve Booked', 'Faye Completed', 'Main Auction',
    ]));
    await page.screenshot({ path: `${OUT}/all-on.png` });
  });

  test('all chips OFF shows zero events (force-1 guard removed)', async ({ page }) => {
    await setChipState(page, []);
    const names = await visibleEventNames(page);
    expect(names).toEqual([]);
    // Belt-and-suspenders: no .cal-event nodes anywhere in the month view.
    expect(await page.locator('.cal-month-view .cal-event').count()).toBe(0);
    await page.screenshot({ path: `${OUT}/all-off.png` });
  });

  test('Booked alone shows only the booked inquiry plus the unlinked GCal event', async ({ page }) => {
    await setChipState(page, ['Booked']);
    const names = await visibleEventNames(page);
    expect(new Set(names)).toEqual(new Set(['Eve Booked', 'Main Auction']));
  });

  test('Completed alone shows only the completed inquiry', async ({ page }) => {
    await setChipState(page, ['Completed']);
    const names = await visibleEventNames(page);
    expect(names).toEqual(['Faye Completed']);
  });

  test('Quote Sent alone shows quote_sent AND quote_approved (folded together)', async ({ page }) => {
    await setChipState(page, ['Quote Sent']);
    const names = await visibleEventNames(page);
    expect(new Set(names)).toEqual(new Set(['Carol Sent', 'Dan Approved']));
  });

  test('Quote Drafted alone shows only quote_drafted', async ({ page }) => {
    await setChipState(page, ['Quote Drafted']);
    const names = await visibleEventNames(page);
    expect(names).toEqual(['Bob Drafted']);
  });

  test('Needs More Info alone shows only needs_info', async ({ page }) => {
    await setChipState(page, ['Needs More Info']);
    const names = await visibleEventNames(page);
    expect(names).toEqual(['Alice Needs']);
  });

  test('Quote Sent + Booked union shows quote_sent + quote_approved + booked + unlinked', async ({ page }) => {
    await setChipState(page, ['Quote Sent', 'Booked']);
    const names = await visibleEventNames(page);
    expect(new Set(names)).toEqual(new Set([
      'Carol Sent', 'Dan Approved', 'Eve Booked', 'Main Auction',
    ]));
  });
});
