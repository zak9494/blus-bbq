// @ts-check
// Regression — /notifications page must NOT contain its own duplicate hamburger
// button inside the page topbar. Original bug: the page rendered a local
// <button class="hamburger-btn"> in addition to whatever global nav (sidebar
// hamburger or nav_v2 tab bar) the app uses, leaving two hamburgers stacked
// on mobile. Fix removes the duplicate from the page topbar.
//
// We assert ONLY the in-page invariant ("no hamburger inside #page-notifications").
// The global hamburger count varies with the nav_v2 flag state — when nav_v2
// is ON (current default) the global .mobile-hamburger is hidden by
// .nav-v2-active CSS and nav_v2 uses a bottom tab bar, so the visible count
// is 0 across all viewports. When nav_v2 is OFF the legacy hamburger reappears
// on mobile. Either is correct for this regression — what we're guarding
// against is the duplicate INSIDE the page, not the global nav scheme.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-notif-page-no-dup-hamburger');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] /notifications has no duplicate hamburger`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

    await page.evaluate(() => {
      if (typeof showPage === 'function') showPage('notifications');
    });
    await expect(page.locator('#page-notifications')).toHaveClass(/active/, { timeout: 4000 });

    // No inline hamburger inside the notifications page topbar — defer to
    // whatever global nav scheme the app is using.
    await expect(page.locator('#page-notifications .hamburger-btn')).toHaveCount(0);
    await expect(page.locator('#page-notifications [class*="hamburger"]')).toHaveCount(0);

    await page.screenshot({ path: path.join(OUT, `notif-page-${vp.name}.png`), fullPage: true });
  });
}
