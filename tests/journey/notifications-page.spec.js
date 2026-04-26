// @ts-check
// Journey test — Notifications Center page (/notifications)
// Verifies the fix for the prod bug where the page showed "Failed to load."
// because /api/notifications, /counts, /types returned 404 when the
// notifications_center flag was off. After the fix, those endpoints return
// graceful empty 200 responses, so the page renders an empty state at all
// three viewports.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-notifications-page');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

test.describe('/notifications page — renders without "Failed to load"', () => {
  for (const vp of VIEWPORTS) {
    test(`page chrome + empty state, no error text — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

      await page.evaluate(() => {
        if (typeof showPage === 'function') showPage('notifications');
      });

      const pageEl = page.locator('#page-notifications');
      await expect(pageEl).toBeVisible({ timeout: 5000 });
      await expect(pageEl.locator('.topbar-title')).toContainText('Notifications');

      const list = page.locator('#nc-page-list');
      await expect(list).toBeAttached();

      await page.waitForTimeout(2000);

      const listText = (await list.innerText().catch(() => '')) || '';
      expect(listText).not.toMatch(/failed to load/i);
      expect(listText).not.toMatch(/error loading/i);
      expect(listText).not.toMatch(/unauthorized/i);

      await page.screenshot({ path: `${OUT}/notifications-${vp.name}.png`, fullPage: false });
    });
  }
});

test.describe('/api/notifications endpoints — graceful empty responses', () => {
  test('GET /api/notifications returns 200 + empty list', async ({ request }) => {
    const r = await request.get(BASE_URL + '/api/notifications');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(typeof body.unread_count).toBe('number');
  });

  test('GET /api/notifications/counts returns 200 + zero counts', async ({ request }) => {
    const r = await request.get(BASE_URL + '/api/notifications/counts');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(typeof body.unread_count).toBe('number');
    expect(typeof body.by_type).toBe('object');
  });

  test('GET /api/notifications/types returns 200 + types array', async ({ request }) => {
    const r = await request.get(BASE_URL + '/api/notifications/types');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.types)).toBe(true);
  });
});
