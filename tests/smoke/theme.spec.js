// @ts-check
// Theme smoke tests — light/dark toggle and persistence.
// Migrated from tests/smoke.spec.js.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

test('theme toggle switches from light to dark', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.locator('#theme-toggle-btn').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('theme preference persists across page reload', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  await page.locator('#theme-toggle-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
