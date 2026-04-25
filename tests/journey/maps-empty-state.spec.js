// @ts-check
// Journey test — maps_v1 empty-state notice (Wave 4 polish)
// When `maps_v1` flag is ON but no shop origin address is configured:
//   1. Event-day cards render an empty-state notice in place of the View Map button.
//   2. Settings → Shop Info shows a warning chip under the address field.
//   3. After saving an address, both notices disappear and the View Map button appears.
// Viewports: iphone (375), ipad (768), desktop (1280).
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-maps-empty-state');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const TEST_ADDRESS = '123 Test St, Test City TX 12345';

const MOCK_EVENT = {
  threadId: 'thread_maps_empty_001',
  customer_name: 'Empty State Customer',
  event_date: '2026-05-20',
  event_time: '14:00',
  delivery_address: '4732 Nashwood Ln, Dallas TX 75229',
  guest_count: 50,
  status: 'booked',
};

async function setupMocks(page, { shopAddress = null, mapsEnabled = true } = {}) {
  // Stateful shop-origin handler — POST updates state, subsequent GET returns saved value
  let currentAddress = shopAddress;

  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));
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
  await page.route('**/api/settings/shop-origin*', r => {
    if (r.request().method() === 'POST') {
      try {
        const body = JSON.parse(r.request().postData() || '{}');
        currentAddress = (body.address || '').trim() || null;
      } catch (_) {}
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, address: currentAddress || '' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ address: currentAddress }) });
  });
  await page.route('**/api/maps/distance*', r => {
    if (!currentAddress) {
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'no_origin_address' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, miles: 8.2, freeFlowMin: 15, trafficMin: 22, origin: currentAddress }) });
  });
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',         enabled: true,        description: '' },
      { name: 'event_day_view', enabled: true,        description: '' },
      { name: 'maps_v1',        enabled: mapsEnabled, description: '' },
    ]}) }));
}

async function openEventDayView(page) {
  await page.evaluate(function () {
    if (typeof showPage === 'function') showPage('today');
    if (typeof window.loadEventDayView === 'function') window.loadEventDayView();
  });
  await page.waitForTimeout(500);
}

// ── 1. Empty address + maps_v1 ON → notice in place of View Map button ────────
test.describe('Maps empty state — notice in place of View Map button', () => {
  for (const vp of VIEWPORTS) {
    test(`[${vp.name}] empty-state notice on event-day card; no View Map button`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, { shopAddress: null, mapsEnabled: true });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await openEventDayView(page);

      // Notice should appear after the distance fetch resolves with no_origin_address.
      // Auto-retry waits for the async swap (button + chip removed; notice inserted).
      const notice = page.locator('[data-testid="maps-empty-notice"]').first();
      await expect(notice).toBeVisible({ timeout: 5000 });
      const noticeText = await notice.textContent();
      expect(noticeText).toMatch(/Set your shop address/i);
      expect(noticeText).toMatch(/Settings/);

      // After swap: no View Map button or distance chip on the card
      await expect(page.locator('.maps-view-btn')).toHaveCount(0);
      await expect(page.locator('.maps-dist-chip')).toHaveCount(0);

      await page.screenshot({ path: path.join(OUT, `empty-notice-${vp.name}.png`), fullPage: false });
    });
  }
});

// ── 2. Settings → Shop Info shows warning chip when empty + flag ON ───────────
test.describe('Maps empty state — Settings warning chip', () => {
  for (const vp of VIEWPORTS) {
    test(`[${vp.name}] Settings shows warning under empty address field`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, { shopAddress: null, mapsEnabled: true });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

      // Wait for flags to load (warning visibility depends on flags being ready)
      await page.waitForFunction(function () {
        return window.flags && window.flags.isEnabled && window.flags.isEnabled('maps_v1');
      }, { timeout: 5000 }).catch(() => {});

      await page.evaluate(() => window.showPage('settings'));
      await page.waitForTimeout(400);

      const warn = page.locator('[data-testid="maps-shop-warn"]');
      await expect(warn).toBeVisible();
      const warnText = await warn.textContent();
      expect(warnText).toMatch(/Maps.*disabled until this is set/i);

      const input = page.locator('#settings-shop-address');
      expect(await input.inputValue()).toBe('');

      await page.screenshot({ path: path.join(OUT, `settings-warning-${vp.name}.png`), fullPage: false });
    });
  }
});

// ── 3. Save address → notice + warning disappear; View Map button appears ────
test.describe('Maps empty state — clears after address is saved', () => {
  for (const vp of VIEWPORTS) {
    test(`[${vp.name}] saving address removes notice + warning`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, { shopAddress: null, mapsEnabled: true });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

      await page.waitForFunction(function () {
        return window.flags && window.flags.isEnabled && window.flags.isEnabled('maps_v1');
      }, { timeout: 5000 }).catch(() => {});

      // Verify warning visible first
      await page.evaluate(() => window.showPage('settings'));
      await page.waitForTimeout(300);
      await expect(page.locator('[data-testid="maps-shop-warn"]')).toBeVisible();

      // Fill in address and save
      await page.locator('#settings-shop-address').fill(TEST_ADDRESS);
      await page.locator('button[onclick="saveShopAddress()"]').click();
      await page.waitForTimeout(500);

      // Warning should now be hidden
      await expect(page.locator('[data-testid="maps-shop-warn"]')).toBeHidden();

      // Confirm window state updated
      const addr = await page.evaluate(() => window.shopOriginAddress);
      expect(addr).toBe(TEST_ADDRESS);

      // Re-open event-day view; notice gone, View Map button present
      await openEventDayView(page);
      await page.waitForTimeout(400);

      await expect(page.locator('[data-testid="maps-empty-notice"]')).toHaveCount(0);
      await expect(page.locator('.maps-view-btn').first()).toBeVisible();

      await page.screenshot({ path: path.join(OUT, `cleared-${vp.name}.png`), fullPage: false });
    });
  }
});

// ── 4. maps_v1 OFF → no notice anywhere even if address empty ─────────────────
test.describe('Maps empty state — flag OFF suppresses everything', () => {
  test('[desktop] flag OFF + empty address → no notice on event-day, no warning in Settings', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, { shopAddress: null, mapsEnabled: false });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await openEventDayView(page);

    await expect(page.locator('[data-testid="maps-empty-notice"]')).toHaveCount(0);
    await expect(page.locator('.maps-view-btn')).toHaveCount(0);

    await page.evaluate(() => window.showPage('settings'));
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="maps-shop-warn"]')).toBeHidden();

    await page.screenshot({ path: path.join(OUT, 'flag-off-desktop.png'), fullPage: false });
  });
});
