// @ts-check
// Journey test — Notifications bell flyout auto-closes on nav, click-outside, Esc.
// Bug: drawer opened via the bell stayed open after SPA route changes, leaving
// the flyout overlapping every page (visible in retroactive audit screenshots
// 2026-04-25). Fix wires showPage and Escape to closeDrawer; outside-click
// already closes via the overlay.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-notif-flyout-autoclose');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

async function bootAndOpenBell(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  // The legacy #nc-bell-btn (top-right fixed) is occluded by the nav-v2 topbar
  // on every viewport. Open the drawer the same way the production-bug-state
  // gets reached in field reports — direct toggle call. This still exercises
  // the same open/close code path (overlay, drawer DOM, _drawerOpen state).
  await page.waitForFunction(() =>
    typeof window.notifPanelToggleDrawer === 'function', { timeout: 8000 });
  await page.evaluate(() => window.notifPanelToggleDrawer());
  await page.waitForFunction(() => {
    const d = document.getElementById('nc-drawer');
    return d && d.classList.contains('nc-drawer-open');
  }, { timeout: 4000 });
}

async function expectDrawerClosed(page, label) {
  // After close: the open class is removed and (post-transition) display: none.
  await page.waitForFunction(() => {
    const d = document.getElementById('nc-drawer');
    return d && !d.classList.contains('nc-drawer-open');
  }, { timeout: 3000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`bell flyout auto-close — ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });

    test(`closes when navigating to another page (showPage)`, async ({ page }) => {
      await bootAndOpenBell(page);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-1-open.png`) });

      // Trigger SPA nav — this is the real-user path (sidebar item) reduced to
      // the underlying call for determinism across viewports.
      await page.evaluate(() => { if (typeof showPage === 'function') showPage('calendar'); });

      await expectDrawerClosed(page, 'after-nav');
      await page.screenshot({ path: path.join(OUT, `${vp.name}-2-after-nav.png`) });
    });

    test(`closes on Escape key`, async ({ page }) => {
      await bootAndOpenBell(page);
      await page.keyboard.press('Escape');
      await expectDrawerClosed(page, 'after-escape');
    });

    test(`closes on outside (overlay) click`, async ({ page }) => {
      await bootAndOpenBell(page);
      // The overlay element is the click-outside target.
      await page.locator('#nc-drawer-overlay').click({ position: { x: 5, y: 5 } });
      await expectDrawerClosed(page, 'after-outside-click');
    });
  });
}
