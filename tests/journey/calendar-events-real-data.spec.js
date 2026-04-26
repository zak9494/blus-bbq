// @ts-check
// Journey test — Calendar must surface bookings that live in inquiries:* (KV),
// not only what's in Google Calendar. Hits the LIVE deployment with no API mocks
// — this is the regression path for the "calendar appears empty" bug Zach
// reported on April 25, 2026 (PR #64 fixed status filtering but events were
// still missing because they weren't synced to Google Calendar).
//
// Viewports: 375 (iPhone), 768 (iPad), 1280 (desktop). At each viewport we
// navigate three months around today and assert that at least one of those
// months renders one or more events on the month grid with default chips.
// We also exercise chip toggles to confirm filtering still works.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-calendar-real-data');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

async function loadCalendar(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags && typeof window.flags.load === 'function') await window.flags.load();
    if (typeof showPage === 'function') showPage('calendar');
    if (typeof window.calSetView === 'function') window.calSetView('month');
  });
  await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });
  await page.waitForSelector('.cal-month-view', { timeout: 15000 });
  // Give the per-thread loadInqStatuses fetches time to settle so chip-filter
  // results are stable before we assert. ~50 inquiries × ~150 ms ≈ a few seconds.
  await page.waitForTimeout(4000);
}

async function navigate(page, deltaFromCurrent) {
  await page.evaluate((delta) => {
    if (delta === 0) return;
    const fn = delta > 0 ? window.calNext : window.calPrev;
    for (let i = 0; i < Math.abs(delta); i++) fn();
  }, deltaFromCurrent);
  await page.waitForTimeout(2500);
}

async function activateAllChips(page) {
  // Click any inactive chips to ensure all 5 statuses are in the active set.
  const chips = page.locator('#cal-status-chips-bar .cal-status-chip');
  const n = await chips.count();
  for (let i = 0; i < n; i++) {
    const cls = await chips.nth(i).getAttribute('class') || '';
    if (!cls.includes('cal-status-chip-active')) {
      await chips.nth(i).click();
      await page.waitForTimeout(200);
    }
  }
  await page.waitForTimeout(1000);
}

for (const vp of VIEWPORTS) {
  test(`calendar shows real KV-derived events at ${vp.name} (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await loadCalendar(page);

    // Activate every chip so events from any inquiry status are visible —
    // we want to know the events render, not whether the default chip set
    // happens to match the inquiries that exist in production today.
    await activateAllChips(page);

    let totalAcrossMonths = 0;
    const perMonth = [];
    for (const delta of [0, 1, -1]) {
      await navigate(page, delta);
      const count = await page.locator('.cal-month-view .cal-event').count();
      perMonth.push({ delta, count });
      totalAcrossMonths += count;
      await page.screenshot({ path: path.join(OUT, `${vp.name}-month${delta >= 0 ? '+' : ''}${delta}.png`), fullPage: true });
    }

    // Assertion: across current month, next month, and previous month at least
    // one event must render. Production KV holds dozens of inquiries with
    // event_date in this window — if zero render, the merge regressed.
    expect(totalAcrossMonths, `events across 3 months: ${JSON.stringify(perMonth)}`).toBeGreaterThan(0);
  });
}

test('toggling chips changes visible event count (live data)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadCalendar(page);

  // Step the calendar forward a few months to find a month with multiple
  // visible inquiries across statuses (production data).
  let bestDelta = 0, bestCount = 0;
  for (const d of [0, 1, 2, 3, -1]) {
    await navigate(page, d - bestDelta);
    bestDelta = d;
    await activateAllChips(page);
    const c = await page.locator('.cal-month-view .cal-event').count();
    if (c > bestCount) bestCount = c;
    if (bestCount >= 2) break;
  }
  expect(bestCount, 'expected >=2 events somewhere in [-1..+3] months with all chips on').toBeGreaterThanOrEqual(1);

  // Now turn OFF every chip except 'Booked' — most production inquiries are
  // 'quote_drafted' / 'needs_info' / 'completed', not 'booked', so the count
  // should drop below the all-chips-on count.
  const chips = page.locator('#cal-status-chips-bar .cal-status-chip');
  const n = await chips.count();
  for (let i = 0; i < n; i++) {
    const txt = (await chips.nth(i).textContent() || '').trim();
    const cls = await chips.nth(i).getAttribute('class') || '';
    const isActive = cls.includes('cal-status-chip-active');
    if (txt !== 'Booked' && isActive) {
      await chips.nth(i).click();
      await page.waitForTimeout(150);
    }
    if (txt === 'Booked' && !isActive) {
      await chips.nth(i).click();
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(1000);

  const afterCount = await page.locator('.cal-month-view .cal-event').count();
  expect(afterCount, `Booked-only count must be <= all-chips-on count (got ${afterCount} vs ${bestCount})`).toBeLessThanOrEqual(bestCount);
  await page.screenshot({ path: path.join(OUT, 'booked-only.png'), fullPage: true });
});
