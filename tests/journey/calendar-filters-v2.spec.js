// @ts-check
// Regression tests — calendar_filters_v2 status chip filtering
// Verifies that events matching the active status chip are visible, and that
// events with non-matching status are hidden when calendar_filters_v2 is ON.
// Covers the bug fix: loadInqStatuses() must run when calendar_filters_v2 is ON
// (previously gated only on calendar_v2), and the secret must be included in the fetch.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-calendar-filters-v2');
fs.mkdirSync(OUT, { recursive: true });

// Serve the local fixed calendar.js so tests always run against the patched code,
// even when BASE_URL points to production (which has the old build).
const LOCAL_CALENDAR_JS = fs.readFileSync(
  path.join(__dirname, '../../static/js/calendar.js'), 'utf8');

const BOOKED_THREAD = 'cal-filter-test-booked';
const NEEDS_THREAD  = 'cal-filter-test-needs';

// Build events in the CURRENT month so no navigation is needed.
// (The calendar module's internal calDate starts as new Date(), so it loads the current month.)
function makeEvents() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, '0');
  return [
    {
      id: 'cal-ev-booked',
      summary: 'Smith Family BBQ',
      start: { dateTime: `${y}-${m}-14T12:00:00-05:00` },
      end:   { dateTime: `${y}-${m}-14T15:00:00-05:00` },
      extendedProperties: { private: { blusBbqThreadId: BOOKED_THREAD } },
    },
    {
      id: 'cal-ev-needs',
      summary: 'Jones Corporate Lunch',
      start: { dateTime: `${y}-${m}-21T11:00:00-05:00` },
      end:   { dateTime: `${y}-${m}-21T14:00:00-05:00` },
      extendedProperties: { private: { blusBbqThreadId: NEEDS_THREAD } },
    },
  ];
}

async function setupMocks(page, extraFlags) {
  extraFlags = extraFlags || [];
  // Inject local fixed calendar.js so tests verify the patched code
  await page.route('**/static/js/calendar.js', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: LOCAL_CALENDAR_JS }));
  // Default: block all API routes
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ unread: 0 }) }));

  // Calendar list: always return test events (current month)
  await page.route('**/api/calendar/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, events: makeEvents() }) }));

  // Inquiry get: return statuses for the test thread IDs
  await page.route('**/api/inquiries/get*', r => {
    const url = new URL(r.request().url());
    const tid = url.searchParams.get('threadId');
    if (tid === BOOKED_THREAD) {
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, inquiry: { status: 'booked' } }) });
    } else if (tid === NEEDS_THREAD) {
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, inquiry: { status: 'needs_info' } }) });
    } else {
      r.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ error: 'not found' }) });
    }
  });

  var baseFlags = [
    { name: 'nav_v2',              enabled: false, description: '' },
    { name: 'kanban_restructure',  enabled: true,  description: '' },
    { name: 'calendar_v2',         enabled: false, description: '' },
    { name: 'calendar_filters_v2', enabled: false, description: '' },
  ];
  extraFlags.forEach(function (ef) {
    var idx = baseFlags.findIndex(function (f) { return f.name === ef.name; });
    if (idx >= 0) baseFlags[idx] = ef; else baseFlags.push(ef);
  });
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: baseFlags }) }));
}

async function loadCalendar(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('calendar');
  });
  // Wait for the chip bar AND at least one calendar day cell (grid rendered)
  await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });
  // Give loadInqStatuses() time to complete (it resolves before render() is called)
  await page.waitForSelector('.cal-month-view', { timeout: 10000 });
}

// ── calendar_filters_v2 ON (calendar_v2 OFF): booked event is visible ─────────
test('calendar_filters_v2 ON — booked event visible with Booked chip active', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, [
    // calendar_v2 intentionally OFF — this is the production config that was broken.
    // The fix ensures loadInqStatuses() runs when only calendar_filters_v2 is ON.
    { name: 'calendar_filters_v2', enabled: true, description: '' },
  ]);
  await loadCalendar(page);

  // Booked chip active by default → booked event must appear
  await expect(page.locator('.cal-event-name', { hasText: 'Smith Family BBQ' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/booked-event-visible.png` });
});

// ── Deactivating Booked chip hides the booked event ──────────────────────────
test('calendar_filters_v2 ON — deactivating Booked chip hides booked event', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, [
    { name: 'calendar_filters_v2', enabled: true, description: '' },
  ]);
  await loadCalendar(page);

  // Activate Needs More Info so we still have at least one active chip
  await page.locator('#cal-status-chips-bar .cal-status-chip', { hasText: 'Needs More Info' }).click();

  // Deactivate Booked
  const bookedChip = page.locator('#cal-status-chips-bar .cal-status-chip', { hasText: 'Booked' });
  await bookedChip.click();
  await expect(bookedChip).not.toHaveClass(/cal-status-chip-active/);

  // Booked event gone, needs_info event visible
  await expect(page.locator('.cal-event-name', { hasText: 'Smith Family BBQ' })).toHaveCount(0);
  await expect(page.locator('.cal-event-name', { hasText: 'Jones Corporate Lunch' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/booked-chip-off.png` });
});

// ── Activating Needs More Info chip reveals needs_info event ─────────────────
test('calendar_filters_v2 ON — Needs More Info chip reveals needs_info event', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, [
    { name: 'calendar_filters_v2', enabled: true, description: '' },
  ]);
  await loadCalendar(page);

  // Initially needs_info chip OFF → Jones event not visible
  await expect(page.locator('.cal-event-name', { hasText: 'Jones Corporate Lunch' })).toHaveCount(0);

  // Activate Needs More Info
  const needsChip = page.locator('#cal-status-chips-bar .cal-status-chip', { hasText: 'Needs More Info' });
  await needsChip.click();
  await expect(needsChip).toHaveClass(/cal-status-chip-active/);

  // Now Jones event appears
  await expect(page.locator('.cal-event-name', { hasText: 'Jones Corporate Lunch' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/needs-chip-on.png` });
});

// ── Mobile (iPhone 375px) month grid: 5 chips + booked event visible ─────────
// Captures the production bug Zach reported: at iPhone width with v2 filters ON,
// the month grid was empty regardless of chip state. After the fix:
// - all 5 status chips render
// - the Booked chip is active by default → Smith Family BBQ event renders on
//   the month grid BEFORE any user interaction.
test('calendar_filters_v2 ON — iPhone 375px month grid: 5 chips + event renders before any interaction', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await setupMocks(page, [
    { name: 'calendar_filters_v2', enabled: true, description: '' },
  ]);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('calendar');
    // Mobile defaults to day view; the reported bug was on the month grid,
    // so explicitly switch to month view before asserting.
    if (typeof window.calSetView === 'function') window.calSetView('month');
  });
  await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });
  await page.waitForSelector('.cal-month-view', { timeout: 10000 });

  const chipBar = page.locator('#cal-status-chips-bar');
  await expect(chipBar).toBeVisible();
  await expect(chipBar.locator('.cal-status-chip')).toHaveCount(5);

  for (const label of ['Needs More Info', 'Quote Drafted', 'Quote Sent', 'Booked', 'Completed']) {
    await expect(chipBar.locator('.cal-status-chip', { hasText: label })).toHaveCount(1);
  }

  // Booked chip active by default → at least one event renders on the month grid
  // BEFORE any chip interaction. This is the user-visible regression: the grid
  // was previously empty regardless of chip state.
  // (At 375px the .cal-event-name text gets clipped by overflow:hidden on narrow
  // day cells, so we assert on the .cal-event parent and the cal-has-events
  // marker class — both signal "events render on the grid".)
  await expect(page.locator('.cal-month-view .cal-day.cal-has-events').first()).toBeVisible();
  expect(await page.locator('.cal-month-view .cal-event').count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${OUT}/iphone-month-grid.png`, fullPage: true });
});
