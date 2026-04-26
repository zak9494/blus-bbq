// @ts-check
// Journey test — Notification Settings is a sub-page under Settings (not a 6th tab).
// Verifies: Settings page shows a "Notifications" entry; tapping it navigates to
// the notif-settings page; the page renders cleanly (no error text, exactly one
// hamburger), and the back button returns to the Settings page.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-notif-settings-subpage');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const MOCK_SETTINGS = {
  channels: { push: true, in_app: true, email: true, sms: true },
  events: {
    follow_up_due: true, deposit_overdue: true, customer_reply: true,
    quote_sent: true, event_tomorrow: true, event_today: true,
    inquiry_needs_review: true,
  },
};
const CHANNELS = ['push', 'in_app', 'email', 'sms'];
const EVENTS   = Object.keys(MOCK_SETTINGS.events);

async function setupMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, unread_count: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
  await page.route('**/api/pipeline/alerts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, alerts: [] }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',                   enabled: true,  description: '' },
      { name: 'notification_settings_v1', enabled: true,  description: '' },
    ]}) }));

  await page.route('**/api/notification-settings**', r => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, tenantId: 'default',
        settings: MOCK_SETTINGS,
        channels: CHANNELS, events: EVENTS,
      }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, tenantId: 'default', settings: MOCK_SETTINGS }) });
  });
}

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] Settings → Notifications sub-page round-trip`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupMocks(page);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForFunction(
      () => window.flags && window.flags.isEnabled && typeof window.flags.isEnabled('notification_settings_v1') === 'boolean',
      { timeout: 10000 }
    );

    // 1. Land on Settings
    await page.evaluate(() => window.showPage('settings'));
    await expect(page.locator('#page-settings')).toHaveClass(/active/, { timeout: 4000 });

    // 2. The Notifications entry must be visible in the settings list
    const notifRow = page.locator('#settings-row-notifications');
    await expect(notifRow).toBeVisible();
    await expect(notifRow).toContainText(/Notifications/i);

    await page.screenshot({ path: path.join(OUT, `settings-${vp.name}.png`), fullPage: true });

    // 3. Tap → navigates to notif-settings page
    await notifRow.click();
    await expect(page.locator('#page-notif-settings')).toHaveClass(/active/, { timeout: 4000 });

    // 4. Page renders the actual notification settings (toggles), not an error
    await expect(page.locator('#ns-page-body .ns-section').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#page-notif-settings .ns-empty-err')).toHaveCount(0);

    const bodyText = (await page.locator('#page-notif-settings').textContent()) || '';
    expect(bodyText).not.toMatch(/failed to load/i);
    expect(bodyText).not.toMatch(/unauthorized/i);

    // 5. No inline hamburger inside the notif-settings page topbar
    await expect(page.locator('#page-notif-settings .hamburger-btn')).toHaveCount(0);
    await expect(page.locator('#page-notif-settings [class*="hamburger"]')).toHaveCount(0);

    // 6. Exactly one canonical hamburger across the whole document
    await expect(page.locator('button.mobile-hamburger')).toHaveCount(1);

    await page.screenshot({ path: path.join(OUT, `notif-settings-${vp.name}.png`), fullPage: true });

    // 7. Back button is present and returns to Settings page
    const backBtn = page.locator('#page-notif-settings .ns-back-btn');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page.locator('#page-settings')).toHaveClass(/active/, { timeout: 4000 });
    await expect(page.locator('#page-notif-settings')).not.toHaveClass(/active/);

    // 8. The Notifications entry is still there after returning
    await expect(page.locator('#settings-row-notifications')).toBeVisible();
  });
}
