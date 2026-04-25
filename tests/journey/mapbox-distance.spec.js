// @ts-check
// Journey test — maps_v1: Mapbox distance + traffic-aware drive time
// Scenarios:
//   1. Flag OFF → no time chip, no View Map button on event-day cards
//   2. Flag ON + mock /api/maps/distance → time chip renders "X.X mi · N / M min"
//      and View Map button href contains origin + destination
//   3. Flag ON + /api/maps/distance returns { ok: false } → chip hidden, View Map button still visible
// Viewport: 375 (mobile primary), 1280 (desktop)
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-maps-v1');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
];

const MOCK_DISTANCE = {
  ok: true,
  miles: 12.4,
  freeFlowMin: 18,
  trafficMin: 27,
  origin: '17630 Preston Rd, Dallas TX 75252',
};

const MOCK_EVENT = {
  threadId: 'thread_maps_test_001',
  customer_name: 'Maps Test Customer',
  event_date: '2026-05-20',
  event_time: '14:00',
  delivery_address: '4732 Nashwood Ln, Dallas TX 75229',
  guest_count: 50,
  status: 'booked',
};

async function setupCommonMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"flags":[]}' }));
  await page.route('**/api/notifications/counts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
  await page.route('**/api/pipeline/alerts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, alerts: [] }) }));
  await page.route('**/api/pipeline/overdue*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [] }) }));
  await page.route('**/api/customers/tags*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, tags: [] }) }));
  await page.route('**/api/events/today*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, date: '2026-05-20', events: [MOCK_EVENT] }) }));
}

// Navigate to the event-day view (Today tab)
async function openEventDayView(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // Trigger the Today/event-day page
  await page.evaluate(function () {
    if (typeof showPage === 'function') showPage('today');
    if (typeof window.loadEventDayView === 'function') window.loadEventDayView();
  });
  await page.waitForTimeout(600);
}

for (const vp of VIEWPORTS) {
  test.describe(`maps_v1 @ ${vp.name} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('flag OFF — no time chip, no View Map button', async ({ page }) => {
      await setupCommonMocks(page);
      // flags endpoint returns maps_v1 disabled
      await page.route('**/api/flags', r =>
        r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ flags: [{ name: 'maps_v1', enabled: false }] }) }));

      await openEventDayView(page);

      await expect(page.locator('.maps-dist-chip')).toHaveCount(0);
      await expect(page.locator('.maps-view-btn')).toHaveCount(0);

      await page.screenshot({ path: path.join(OUT, `flag-off-${vp.name}.png`), fullPage: false });
    });

    test('flag ON + success → chip shows "X.X mi · N / M min" and View Map button present', async ({ page }) => {
      await setupCommonMocks(page);
      await page.route('**/api/flags', r =>
        r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ flags: [{ name: 'maps_v1', enabled: true }, { name: 'event_day_view', enabled: true }] }) }));
      await page.route('**/api/maps/distance*', r =>
        r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(MOCK_DISTANCE) }));

      await openEventDayView(page);

      // Wait for async distance fetch to complete and chip to update
      await page.waitForFunction(function () {
        var chip = document.querySelector('.maps-dist-chip');
        return chip && !chip.classList.contains('maps-loading');
      }, { timeout: 5000 }).catch(() => {});

      const chip = page.locator('.maps-dist-chip').first();
      await expect(chip).toBeVisible();
      const chipText = await chip.textContent();
      expect(chipText).toMatch(/\d+\.\d+\s*mi/);
      expect(chipText).toMatch(/\d+\s*\/\s*\d+\s*min/);

      const viewBtn = page.locator('.maps-view-btn').first();
      await expect(viewBtn).toBeVisible();
      const href = await viewBtn.getAttribute('href');
      expect(href).toContain('maps.google.com');
      expect(href).toContain('origin=');
      expect(href).toContain('destination=');

      await page.screenshot({ path: path.join(OUT, `flag-on-success-${vp.name}.png`), fullPage: false });
    });

    test('flag ON + API error → chip hidden, View Map button still visible', async ({ page }) => {
      await setupCommonMocks(page);
      await page.route('**/api/flags', r =>
        r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ flags: [{ name: 'maps_v1', enabled: true }, { name: 'event_day_view', enabled: true }] }) }));
      await page.route('**/api/maps/distance*', r =>
        r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'no_token' }) }));

      await openEventDayView(page);

      // Wait a moment for async fetch
      await page.waitForTimeout(800);

      // Chip should be hidden (display:none) but View Map button still visible
      const chip = page.locator('.maps-dist-chip').first();
      const chipVisible = await chip.isVisible().catch(() => false);
      expect(chipVisible).toBe(false);

      const viewBtn = page.locator('.maps-view-btn').first();
      await expect(viewBtn).toBeVisible();

      await page.screenshot({ path: path.join(OUT, `flag-on-error-${vp.name}.png`), fullPage: false });
    });
  });
}
