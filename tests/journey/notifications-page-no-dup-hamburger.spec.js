// @ts-check
// Regression — /notifications page must show exactly ONE hamburger button.
// Bug: the page's local topbar contained <button class="hamburger-btn"> in addition
// to the global nav_v2 <button class="mobile-hamburger">, causing two visible
// hamburgers on mobile. Fix removes the duplicate from the page topbar and defers
// to the global nav_v2 hamburger. Same bug class as PR #77 (notif-settings).
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
  test(`[${vp.name}] /notifications shows exactly one hamburger`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

    await page.evaluate(() => {
      if (typeof showPage === 'function') showPage('notifications');
    });
    await expect(page.locator('#page-notifications')).toHaveClass(/active/, { timeout: 4000 });

    // No inline hamburger inside the notifications page topbar.
    await expect(page.locator('#page-notifications .hamburger-btn')).toHaveCount(0);
    await expect(page.locator('#page-notifications [class*="hamburger"]')).toHaveCount(0);

    // Across the whole document there must be exactly one *visible* hamburger.
    const visibleHamburgers = page.locator(
      'button.mobile-hamburger:visible, button.hamburger-btn:visible, .hamburger:visible'
    );
    await expect(visibleHamburgers).toHaveCount(1);

    await page.screenshot({ path: path.join(OUT, `notif-page-${vp.name}.png`), fullPage: true });
  });
}
