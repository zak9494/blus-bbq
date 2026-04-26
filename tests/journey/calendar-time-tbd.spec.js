// @ts-check
// Journey test — Calendar event chips must show "TBD" for BBQ-managed events
// without a real time (synthetic inquiry events use start.date, which made
// every chip render "12:00 AM" before fix/calendar-time-tbd-fallback). Real
// timed events must still show their formatted time. Real Google all-day
// events (no BBQ threadId) must show NO time chip — never "12:00 AM" or "TBD".
//
// We intercept /api/calendar/list with a synthetic payload so the assertion
// is deterministic across all 3 viewports.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-calendar-time-tbd');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

function pad(n) { return String(n).padStart(2, '0'); }

function buildPayload() {
  // Anchor synthetic events on the 15th of the current month so they always
  // render in the default month view regardless of when the test runs.
  const now   = new Date();
  const y     = now.getFullYear();
  const m1    = now.getMonth() + 1;
  const dateStr     = `${y}-${pad(m1)}-15`;
  const nextDateStr = `${y}-${pad(m1)}-16`;
  return {
    ok: true,
    nextSyncToken: null,
    calendarId: 'test',
    events: [
      // 1. Real timed BBQ event — should render "6:00 PM"
      {
        id: 'evt-timed',
        summary: 'TimedCustomerXYZ',
        status: 'confirmed',
        start: { dateTime: `${dateStr}T18:00:00-05:00` },
        end:   { dateTime: `${dateStr}T21:00:00-05:00` },
        extendedProperties: { private: { blusBbqThreadId: 'thread-timed' } },
      },
      // 2. BBQ-managed all-day event (synthetic from inquiry) — should render "TBD"
      {
        id: 'evt-bbq-noTime',
        summary: 'TbdCustomerABC',
        status: 'confirmed',
        bbqVirtual: true,
        start: { date: dateStr },
        end:   { date: nextDateStr },
        extendedProperties: { private: { blusBbqThreadId: 'thread-tbd' } },
      },
      // 3. Native Google all-day event (no BBQ threadId) — must render NO time chip
      //    (not "12:00 AM", not "TBD")
      {
        id: 'evt-native-allday',
        summary: 'NativeAllDayDEF',
        status: 'confirmed',
        start: { date: dateStr },
        end:   { date: nextDateStr },
      },
    ],
  };
}

async function loadCalendarWithStub(page) {
  await page.route('**/api/calendar/list*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildPayload()) });
  });
  // The status-color enrichment fetches /api/inquiries/get for each threadId; stub these out.
  await page.route('**/api/inquiries/get*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inquiry: { status: 'booked' } }) });
  });
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags && typeof window.flags.load === 'function') await window.flags.load();
    if (typeof showPage === 'function') showPage('calendar');
    if (typeof window.calSetView === 'function') window.calSetView('month');
  });
  await page.waitForSelector('.cal-month-view', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.cal-month-view .cal-event').length >= 3, null, { timeout: 10000 });
}

for (const vp of VIEWPORTS) {
  test(`calendar chips: TBD for BBQ no-time, real time for timed events @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await loadCalendarWithStub(page);

    // Each chip carries either a "cal-event-time" span (with text) or no time span at all.
    // Find chips by the customer-name span text we control via the stub.
    const chips = page.locator('.cal-month-view .cal-event');

    // BBQ no-time → "TBD"
    const tbdChip = chips.filter({ hasText: 'TbdCustomerABC' }).first();
    await expect(tbdChip).toContainText('TBD');
    await expect(tbdChip).not.toContainText('12:00 AM');

    // Real timed BBQ event → "6:00 PM"
    const timedChip = chips.filter({ hasText: 'TimedCustomerXYZ' }).first();
    await expect(timedChip).toContainText('6:00');
    await expect(timedChip).toContainText('PM');
    await expect(timedChip).not.toContainText('TBD');
    await expect(timedChip).not.toContainText('12:00 AM');

    // Native Google all-day → NO time chip rendered, and definitely not "12:00 AM"
    const nativeChip = chips.filter({ hasText: 'NativeAllDayDEF' }).first();
    await expect(nativeChip).not.toContainText('12:00 AM');
    await expect(nativeChip).not.toContainText('TBD');
    // Should not have a .cal-event-time span at all
    await expect(nativeChip.locator('.cal-event-time')).toHaveCount(0);

    await page.screenshot({ path: path.join(OUT, `${vp.name}.png`), fullPage: true });
  });
}
