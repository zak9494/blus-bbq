// @ts-check
// nav_v2 smoke tests — verifies bottom tab bar renders at iPhone viewport.
// nav_v2 has seed default:true but shared KV may override it; beforeAll sets it explicitly.
const { test, expect } = require('@playwright/test');

const BASE_URL   = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const FLAG_SECRET = 'c857eb539774b63cf0b0a09303adc78d';

test.describe('nav_v2 bottom tab bar (iPhone 375px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // Ensure nav_v2 is ON before running — shared KV may have it disabled.
  test.beforeAll(async ({ request }) => {
    await request.post(`${BASE_URL}/api/flags/nav_v2`, {
      data: { secret: FLAG_SECRET, enabled: true, description: 'Nav v2 — bottom tab bar (mobile) + collapsed sidebar (tablet/desktop); replaces hamburger' },
    }).catch(() => {});
  });

  test('bottom tab bar is visible at iPhone viewport', async ({ page }) => {
    await page.goto(BASE_URL);
    const tabbar = page.locator('#nav-v2-tabbar');
    await expect(tabbar).toBeVisible({ timeout: 8000 });
  });

  test('tab bar has the expected nav tabs', async ({ page }) => {
    await page.goto(BASE_URL);
    const tabbar = page.locator('#nav-v2-tabbar');
    await expect(tabbar).toBeVisible({ timeout: 8000 });
    await expect(tabbar.locator('[data-page="pipeline"]')).toBeVisible();
    await expect(tabbar.locator('[data-page="inquiries"]')).toBeVisible();
    await expect(tabbar.locator('[data-page="calendar"]')).toBeVisible();
  });

  test('hamburger sidebar is hidden when nav_v2 is active', async ({ page }) => {
    await page.goto(BASE_URL);
    const hamburger = page.locator('.mobile-hamburger');
    await expect(hamburger).not.toBeVisible({ timeout: 5000 });
  });
});
