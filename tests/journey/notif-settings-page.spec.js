// @ts-check
// Hotfix journey test — Notification Settings page must load without
// "Failed to load settings: Unauthorized" and must render exactly one
// hamburger button (no inline duplicate inside the page topbar).
// Regression guard for fix/notif-settings-unauthorized-and-dup-nav.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-notif-settings-hotfix');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 667  },
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
      { name: 'nav_v2',                   enabled: false, description: '' },
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
  test(`[${vp.name}] notif-settings page loads without error and shows exactly one hamburger`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupMocks(page);

    // Capture the request URL hitting /api/notification-settings — the GET must not
    // require a secret. Regression: the old client appended `?secret=` and the server
    // 401'd on missing/wrong values for user-facing requests.
    const settingsRequests = [];
    page.on('request', req => {
      const u = req.url();
      if (u.includes('/api/notification-settings') && !u.includes('/save') && req.method() === 'GET') {
        settingsRequests.push(u);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForFunction(
      () => window.flags && window.flags.isEnabled && typeof window.flags.isEnabled('notification_settings_v1') === 'boolean',
      { timeout: 10000 }
    );

    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    await expect(page.locator('#page-notif-settings')).toHaveClass(/active/, { timeout: 4000 });

    // Wait for either the channel toggles or an error to appear, then assert no error.
    await expect(page.locator('#ns-page-body .ns-section').first()).toBeVisible({ timeout: 5000 });

    // No error markers (ns-empty-err is the class set on failure)
    await expect(page.locator('#page-notif-settings .ns-empty-err')).toHaveCount(0);
    await expect(page.locator('#page-notif-settings [role="alert"]')).toHaveCount(0);
    await expect(page.locator('#page-notif-settings .error')).toHaveCount(0);

    // No error text anywhere on the visible page
    const bodyText = (await page.locator('#page-notif-settings').textContent()) || '';
    expect(bodyText).not.toMatch(/failed to load/i);
    expect(bodyText).not.toMatch(/unauthorized/i);
    // "error" alone is too noisy (matches "errors" inside copy); the two above
    // cover the actual failure modes seen in production.

    // Bug 2 guard: no inline hamburger inside the notif-settings page topbar.
    // (The global `.mobile-hamburger` lives outside `#page-notif-settings`.)
    await expect(page.locator('#page-notif-settings .hamburger-btn')).toHaveCount(0);
    await expect(page.locator('#page-notif-settings [class*="hamburger"]')).toHaveCount(0);

    // Across the whole document, the canonical hamburger button (the global mobile
    // one) must exist exactly once. Anything more means a duplicate was reintroduced.
    await expect(page.locator('button.mobile-hamburger')).toHaveCount(1);

    // Client must not append a secret to the GET — that's the failure mode that
    // produced the 401 on production. URL should be the bare endpoint or include
    // only tenantId.
    expect(settingsRequests.length).toBeGreaterThan(0);
    for (const u of settingsRequests) {
      expect(u).not.toMatch(/[?&]secret=/);
    }

    await page.screenshot({
      path: path.join(OUT, `notif-settings-${vp.name}.png`),
      fullPage: true,
    });
  });
}
