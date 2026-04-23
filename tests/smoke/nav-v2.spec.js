// @ts-check
// nav_v2 smoke tests — verifies bottom tab bar renders at iPhone viewport.
// Uses page.route() to mock /api/flags so KV is never touched, preventing
// interference with other smoke tests that rely on sidebar nav items.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

// Intercept /api/flags and return nav_v2:true without touching KV.
async function mockNavV2On(page) {
  await page.route('**/api/flags', async route => {
    try {
      const res  = await route.fetch();
      const json = await res.json();
      const flags = (json.flags || []).map(f =>
        f.name === 'nav_v2' ? Object.assign({}, f, { enabled: true }) : f
      );
      if (!flags.some(f => f.name === 'nav_v2')) {
        flags.push({ name: 'nav_v2', enabled: true,
          description: 'Nav v2 — bottom tab bar (mobile) + collapsed sidebar (tablet/desktop)' });
      }
      await route.fulfill({ json: Object.assign({}, json, { flags }) });
    } catch {
      await route.continue();
    }
  });
}

test.describe('nav_v2 bottom tab bar (iPhone 375px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('bottom tab bar is visible at iPhone viewport', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    const tabbar = page.locator('#nav-v2-tabbar');
    await expect(tabbar).toBeVisible({ timeout: 8000 });
  });

  test('tab bar has the expected nav tabs', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    const tabbar = page.locator('#nav-v2-tabbar');
    await expect(tabbar).toBeVisible({ timeout: 8000 });
    await expect(tabbar.locator('[data-page="pipeline"]')).toBeVisible();
    await expect(tabbar.locator('[data-page="inquiries"]')).toBeVisible();
    await expect(tabbar.locator('[data-page="calendar"]')).toBeVisible();
  });

  test('hamburger sidebar is hidden when nav_v2 is active', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    const hamburger = page.locator('.mobile-hamburger');
    await expect(hamburger).not.toBeVisible({ timeout: 5000 });
  });
});
