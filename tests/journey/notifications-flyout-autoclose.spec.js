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

// notifications_center is default OFF in production; flip it client-side by
// intercepting GET /api/flags so the bell renders without touching KV.
async function forceFlagOn(page) {
  await page.addInitScript(() => {
    const origFetch = window.fetch;
    window.fetch = function (url, opts) {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if (u.includes('/api/flags') && !u.match(/\/api\/flags\/[^?]/)) {
        return origFetch(url, opts).then(function (r) {
          return r.json().then(function (data) {
            if (data && Array.isArray(data.flags)) {
              data.flags.forEach(function (f) {
                if (f.name === 'notifications_center') f.enabled = true;
              });
            }
            return new Response(JSON.stringify(data), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          });
        });
      }
      return origFetch(url, opts);
    };
  });
}

async function bootAndOpenBell(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.waitForSelector('#nc-bell-btn', { state: 'visible', timeout: 8000 });
  await page.locator('#nc-bell-btn').click();
  await page.waitForFunction(() => {
    const d = document.getElementById('nc-drawer');
    return d && d.classList.contains('nc-drawer-open');
  }, { timeout: 3000 });
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
      await forceFlagOn(page);
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
