// @ts-check
// nav_v2 smoke tests — verifies bottom tab bar renders at iPhone viewport.
// Uses mockFlagState() to force nav_v2 ON for the test page context, so the
// suite is independent of prod KV (which can drift — see PR #122).
const { test, expect } = require('@playwright/test');
const { mockFlagState } = require('../helpers/mock-flags');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

test.describe('nav_v2 bottom tab bar (iPhone 375px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('bottom tab bar is visible at iPhone viewport', async ({ page }) => {
    await mockFlagState(page, { nav_v2: true });
    await page.goto(BASE_URL);
    const tabbar = page.locator('#nav-v2-tabbar');
    await expect(tabbar).toBeVisible({ timeout: 8000 });
  });

  test('tab bar has the expected nav tabs', async ({ page }) => {
    await mockFlagState(page, { nav_v2: true });
    await page.goto(BASE_URL);
    const tabbar = page.locator('#nav-v2-tabbar');
    await expect(tabbar).toBeVisible({ timeout: 8000 });
    await expect(tabbar.locator('[data-page="pipeline"]')).toBeVisible();
    await expect(tabbar.locator('[data-page="inquiries"]')).toBeVisible();
    await expect(tabbar.locator('[data-page="calendar"]')).toBeVisible();
  });

  test('hamburger sidebar is hidden when nav_v2 is active', async ({ page }) => {
    await mockFlagState(page, { nav_v2: true });
    await page.goto(BASE_URL);
    const hamburger = page.locator('.mobile-hamburger');
    await expect(hamburger).not.toBeVisible({ timeout: 5000 });
  });
});
