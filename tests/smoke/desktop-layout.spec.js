// @ts-check
// Desktop layout smoke — catches CSS layout regressions (e.g. the nav_v2
// grid-template-columns specificity bug that went undetected at mobile).
// Runs at 1440x900 (desktop) and 375x812 (mobile). All nav_v2 state is
// mocked via page.route so KV is never touched.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

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
          description: 'Nav v2 — bottom tab bar + collapsed sidebar' });
      }
      await route.fulfill({ json: Object.assign({}, json, { flags }) });
    } catch {
      await route.continue();
    }
  });
}

async function mockNavV2Off(page) {
  await page.route('**/api/flags', async route => {
    try {
      const res  = await route.fetch();
      const json = await res.json();
      const flags = (json.flags || []).map(f =>
        f.name === 'nav_v2' ? Object.assign({}, f, { enabled: false }) : f
      );
      await route.fulfill({ json: Object.assign({}, json, { flags }) });
    } catch {
      await route.continue();
    }
  });
}

// ── Desktop 1440px — nav_v2 ON ──────────────────────────────────────────────
test.describe('desktop 1440px — nav_v2 ON', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('main content area starts near left edge (grid regression check)', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });

    const mainBox = await page.locator('.main').boundingBox();
    // Fixed layout:    grid-template-columns: 1fr  → .main at x≈64 (margin-left: 64px), width≈1376
    // Regression:      grid-template-columns: 220px 1fr → .main at x≈284 (220+64), width≈1156
    expect(mainBox.x).toBeLessThan(120);
    expect(mainBox.width).toBeGreaterThan(1200);
  });

  test('nav v2 sidebar is visible at desktop', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });
    await expect(page.locator('#nav-v2-sidebar')).toBeVisible();
  });

  test('sidebar expands to show labels on toggle click', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });
    await page.locator('.nav2-sidebar-toggle').click();
    // Expanded sidebar is 200px wide; collapsed is 64px.
    await expect(page.locator('#nav-v2-sidebar')).toHaveCSS('width', '200px', { timeout: 3000 });
  });

  test('bottom tab bar is hidden at desktop', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });
    await expect(page.locator('#nav-v2-tabbar')).not.toBeVisible();
  });

  for (const pageName of ['inquiries', 'pipeline', 'calendar', 'settings']) {
    test(`nav click — ${pageName} renders content`, async ({ page }) => {
      await mockNavV2On(page);
      await page.goto(BASE_URL);
      await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });
      await page.locator(`#nav-v2-sidebar .nav2-item[data-page="${pageName}"]`).click();
      await expect(page.locator(`#page-${pageName}`)).toBeVisible({ timeout: 5000 });
    });
  }

  test('visual snapshot — 1440x900 home with nav_v2 ON', async ({ page }) => {
    await mockNavV2On(page);
    // Serve the local nav-v2.css so the golden always reflects the intended fixed layout.
    // This intercept means the test catches regressions in everything EXCEPT nav-v2.css itself
    // (the grid regression is caught more precisely by the boundingBox test above).
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const fixedCSS = readFileSync(resolve(__dirname, '../../static/css/nav-v2.css'), 'utf8');
    await page.route('**/static/css/nav-v2.css', async route => {
      await route.fulfill({ contentType: 'text/css', body: fixedCSS });
    });
    await page.goto(BASE_URL);
    await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });
    await expect(page).toHaveScreenshot('nav-v2-desktop-home.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });
});

// ── Desktop 1440px — nav_v2 OFF ─────────────────────────────────────────────
test.describe('desktop 1440px — nav_v2 OFF', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('original sidebar is visible', async ({ page }) => {
    await mockNavV2Off(page);
    await page.goto(BASE_URL);
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
  });

  test('original sidebar nav labels are visible', async ({ page }) => {
    await mockNavV2Off(page);
    await page.goto(BASE_URL);
    await expect(page.locator('.nav-item', { hasText: 'Inquiries' })).toBeVisible({ timeout: 10000 });
  });

  test('main content fills the desktop viewport', async ({ page }) => {
    await mockNavV2Off(page);
    await page.goto(BASE_URL);
    await expect(page.locator('#page-pipeline')).toBeVisible({ timeout: 10000 });
    const mainBox = await page.locator('.main').boundingBox();
    // Old sidebar is 220px; .main should fill the remaining ~1220px.
    expect(mainBox.width).toBeGreaterThan(1000);
  });
});

// ── Mobile 375px — nav_v2 ON ────────────────────────────────────────────────
test.describe('mobile 375px — nav_v2 ON', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('bottom tab bar is visible and anchored to bottom', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    await expect(page.locator('#nav-v2-tabbar')).toBeVisible({ timeout: 10000 });
    const tabBox = await page.locator('#nav-v2-tabbar').boundingBox();
    expect(tabBox.y).toBeGreaterThan(700);
  });

  test('desktop sidebar is hidden at mobile', async ({ page }) => {
    await mockNavV2On(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('.app.nav-v2-active', { timeout: 10000 });
    await expect(page.locator('#nav-v2-sidebar')).not.toBeVisible();
  });
});
