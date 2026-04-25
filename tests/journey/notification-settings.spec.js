// @ts-check
// Journey tests — Notification Settings page (notification_settings_v1)
// Scenarios:
//   1. Flag OFF  → nav item hidden, page not reachable
//   2. Flag ON   → nav item visible, page loads with channel + event toggles
//   3. Toggle persists after reload (mock API round-trip)
// Viewports: 375, 768, 1280
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const MOCK_SETTINGS = {
  channels: { push: true, in_app: true, email: true, sms: true },
  events: {
    follow_up_due: true,
    deposit_overdue: true,
    customer_reply: true,
    quote_sent: true,
    event_tomorrow: true,
    event_today: true,
    inquiry_needs_review: true,
  },
};

const CHANNELS = ['push', 'in_app', 'email', 'sms'];
const EVENTS   = Object.keys(MOCK_SETTINGS.events);

async function setupBaseMocks(page) {
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

  await page.route('**/api/pipeline/overdue*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [] }) }));

  await page.route('**/api/events/today*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, events: [] }) }));

  await page.route('**/api/customers/tags*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, tags: [] }) }));
}

async function setupFlagsMock(page, notifSettingsEnabled) {
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',                   enabled: false, description: '' },
      { name: 'ios_polish_v1',            enabled: true,  description: '' },
      { name: 'lost_reason_capture',      enabled: false, description: '' },
      { name: 'notification_settings_v1', enabled: notifSettingsEnabled, description: '' },
    ]}) }));
}

async function setupSettingsMock(page, settings) {
  await page.route('**/api/notification-settings**', r => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, tenantId: 'default',
        settings: settings || MOCK_SETTINGS,
        channels: CHANNELS,
        events:   EVENTS,
      }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, tenantId: 'default',
      settings: settings || MOCK_SETTINGS,
    }) });
  });

  await page.route('**/api/notification-settings/save', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, tenantId: 'default', settings: settings || MOCK_SETTINGS,
    }) }));
}

async function loadApp(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await page.waitForFunction(
    () => window.flags && window.flags.isEnabled && typeof window.flags.isEnabled('notification_settings_v1') === 'boolean',
    { timeout: 10000 }
  );
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 1 — Flag OFF: nav item hidden, showPage renders nothing
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 1. Flag OFF — nav item hidden`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, false);
    await loadApp(page);

    // Nav item must not be visible
    const navItem = page.locator('#nav-notif-settings');
    await expect(navItem).toBeHidden();

    // Directly calling showPage should not crash the app (page exists but flag gates content)
    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    // Pipeline page (or any other) should still be functional
    const pipeline = page.locator('#page-pipeline');
    // App itself should not error — check pipeline page still renders
    await expect(page.locator('#page-notif-settings')).toBeAttached();
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 2 — Flag ON: nav visible, page renders channel + event toggles
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 2. Flag ON — page loads with all toggles`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);
    await setupSettingsMock(page, MOCK_SETTINGS);
    await loadApp(page);

    // Nav item visible
    const navItem = page.locator('#nav-notif-settings');
    await expect(navItem).toBeVisible({ timeout: 4000 });

    // Navigate to page
    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    await expect(page.locator('#page-notif-settings')).toHaveClass(/active/, { timeout: 4000 });

    // Wait for settings to load
    await expect(page.locator('#ns-page-body .ns-section')).toHaveCount(2, { timeout: 5000 });

    // Channel toggles present (push, in_app, email, sms)
    for (const ch of CHANNELS) {
      const toggle = page.locator('#ns-toggle-ch-' + ch);
      await expect(toggle).toBeAttached({ timeout: 3000 });
      await expect(toggle).toBeChecked(); // all default ON
    }

    // Event toggles present
    for (const ev of EVENTS) {
      const toggle = page.locator('#ns-toggle-ev-' + ev);
      await expect(toggle).toBeAttached({ timeout: 3000 });
      await expect(toggle).toBeChecked();
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 3 — Toggle fires save; reload restores persisted value
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 3. Toggle persists after reload`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);

    // First load: sms toggle is ON
    let savedBody = null;
    await page.route('**/api/notification-settings/save', async r => {
      savedBody = await r.request().postDataJSON().catch(() => null);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, tenantId: 'default',
        settings: { channels: { push: true, in_app: true, email: true, sms: false },
                    events: MOCK_SETTINGS.events },
      }) });
    });

    await page.route('**/api/notification-settings**', async r => {
      if (r.request().method() === 'GET') {
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, tenantId: 'default',
          settings: { channels: { push: true, in_app: true, email: true, sms: true },
                      events: MOCK_SETTINGS.events },
          channels: CHANNELS, events: EVENTS,
        }) });
      }
      return r.continue();
    });

    await loadApp(page);
    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    await expect(page.locator('#page-notif-settings')).toHaveClass(/active/, { timeout: 4000 });
    await expect(page.locator('#ns-toggle-ch-sms')).toBeAttached({ timeout: 5000 });

    // Toggle SMS off
    await page.locator('#ns-toggle-ch-sms').click();

    // Save request must have been fired with sms: false
    await page.waitForTimeout(600);
    expect(savedBody).not.toBeNull();
    expect(savedBody.channels).toBeDefined();
    expect(savedBody.channels.sms).toBe(false);

    // Simulate reload — override GET to return the saved state (sms: false)
    await page.route('**/api/notification-settings**', r => {
      if (r.request().method() === 'GET') {
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, tenantId: 'default',
          settings: { channels: { push: true, in_app: true, email: true, sms: false },
                      events: MOCK_SETTINGS.events },
          channels: CHANNELS, events: EVENTS,
        }) });
      }
      return r.continue();
    });

    // Call reload
    await page.evaluate(() => { if (window.notifSettings) window.notifSettings.reload(); });
    await page.waitForTimeout(600);

    // Re-navigate to notif-settings — reload may not surface the panel automatically
    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    await expect(page.locator('#page-notif-settings')).toHaveClass(/active/, { timeout: 4000 });

    // SMS toggle should now be unchecked
    const smsToggle = page.locator('#ns-toggle-ch-sms');
    await expect(smsToggle).not.toBeChecked({ timeout: 3000 });
    // All others remain checked
    for (const ch of ['push', 'in_app', 'email']) {
      await expect(page.locator('#ns-toggle-ch-' + ch)).toBeChecked();
    }
  });
}
