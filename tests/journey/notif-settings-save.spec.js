// @ts-check
// Hotfix regression test — Notification Settings SAVE must succeed against the
// live production endpoint (no 401). The original bug: the client read the
// secret from `window._appSecret` / `window.APP_SECRET`, neither of which is
// ever set anywhere in the app. Every toggle silently 401'd and the UI flashed
// "Save failed" while the optimistic in-memory state made the toggle appear
// to "stick" until reload. The server expects `body.secret === GMAIL_READ_SECRET`,
// which is the same value the client exposes as `INQ_SECRET`. The fix in PR #75
// (commit 541d544) routed `getSecret()` to read `INQ_SECRET` instead.
//
// This test toggles a channel, asserts the save POST returns 200, asserts the
// UI shows the success toast, reloads the page, and confirms the new state
// persisted. It restores the original toggle state at the end so the live KV
// record is left in the same state it started in.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-notif-settings-save-hotfix');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 667  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const TARGET_CHANNEL = 'sms';
const TARGET_TOGGLE_ID = 'ns-toggle-ch-' + TARGET_CHANNEL;

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] notif-settings SAVE persists without 401`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // Track every save POST. A 401 here is the exact failure mode this fix targets.
    /** @type {{status:number,url:string}[]} */
    const saveResponses = [];
    page.on('response', async r => {
      const u = r.url();
      if (u.includes('/api/notification-settings/save')) {
        saveResponses.push({ status: r.status(), url: u });
      }
    });

    // Capture the request body of the save POST so we can assert the client is
    // actually sending a non-empty secret. The original bug sent `secret: ""`.
    /** @type {string[]} */
    const savePostBodies = [];
    page.on('request', req => {
      if (req.url().includes('/api/notification-settings/save') && req.method() === 'POST') {
        const b = req.postData();
        if (b) savePostBodies.push(b);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForFunction(
      () => window.flags && window.flags.isEnabled && typeof window.flags.isEnabled('notification_settings_v1') === 'boolean',
      { timeout: 15000 }
    );

    // If the flag is OFF in this environment, skip rather than fail — the page would 403.
    const flagOn = await page.evaluate(() => window.flags.isEnabled('notification_settings_v1'));
    test.skip(!flagOn, 'notification_settings_v1 flag is OFF in this environment');

    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    await expect(page.locator('#page-notif-settings')).toHaveClass(/active/, { timeout: 5000 });

    // The checkbox itself is visually hidden inside a custom .ns-switch label.
    // Wait for the input to exist + the surrounding label to be visible/clickable.
    const toggle = page.locator('#' + TARGET_TOGGLE_ID);
    const toggleLabel = page.locator(`label.ns-switch:has(#${TARGET_TOGGLE_ID})`);
    await toggle.waitFor({ state: 'attached', timeout: 8000 });
    await expect(toggleLabel).toBeVisible({ timeout: 8000 });

    // Record initial state so we can restore at end.
    const initiallyOn = await toggle.isChecked();
    const desiredState = !initiallyOn;

    await toggleLabel.click();
    // Confirm the optimistic UI flipped.
    await expect(toggle).toBeChecked({ checked: desiredState, timeout: 3000 });

    // Save status text should appear within ~2s on success.
    const status = page.locator('#ns-save-status');
    await expect(status).toBeVisible({ timeout: 5000 });
    const statusText = (await status.textContent()) || '';
    expect(statusText).toMatch(/saved/i);
    expect(statusText).not.toMatch(/fail/i);

    // No 401 anywhere on the save POST.
    expect(saveResponses.length).toBeGreaterThan(0);
    for (const r of saveResponses) {
      expect(r.status, `save POST returned ${r.status} (${r.url})`).not.toBe(401);
      expect(r.status).toBeLessThan(400);
    }

    // Client must have sent a non-empty secret in the body — proves the fix
    // routed the actual credential rather than the old empty `_appSecret`.
    expect(savePostBodies.length).toBeGreaterThan(0);
    for (const body of savePostBodies) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      expect(parsed && typeof parsed.secret === 'string' && parsed.secret.length > 0,
        'save POST body must include a non-empty `secret` field').toBe(true);
    }

    await page.screenshot({
      path: path.join(OUT, `notif-settings-save-${vp.name}.png`),
      fullPage: true,
    });

    // Reload and assert the new state persisted.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.evaluate(() => { if (window.showPage) window.showPage('notif-settings'); });
    const toggleAfter = page.locator('#' + TARGET_TOGGLE_ID);
    const toggleLabelAfter = page.locator(`label.ns-switch:has(#${TARGET_TOGGLE_ID})`);
    await toggleAfter.waitFor({ state: 'attached', timeout: 8000 });
    await expect(toggleLabelAfter).toBeVisible({ timeout: 8000 });
    const afterReload = await toggleAfter.isChecked();
    expect(afterReload).toBe(desiredState);

    // Restore original state so KV ends in the same state we found it.
    await toggleLabelAfter.click();
    await expect(toggleAfter).toBeChecked({ checked: initiallyOn, timeout: 3000 });
    await expect(status).toBeVisible({ timeout: 5000 });
    const restoreStatus = (await status.textContent()) || '';
    expect(restoreStatus).toMatch(/saved/i);
  });
}
