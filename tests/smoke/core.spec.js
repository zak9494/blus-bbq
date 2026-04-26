// @ts-check
// Core smoke tests — page load, navigation, primary views.
// Migrated from tests/smoke.spec.js.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

test('homepage loads (HTTP 200)', async ({ request }) => {
  const res = await request.get(BASE_URL);
  expect(res.status()).toBe(200);
});

test('Inquiries nav button is present', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  // nav_v2 (default ON) uses [data-page] buttons in sidebar; old .nav-item is hidden
  const inqBtn = page.locator('[data-page="inquiries"]').first();
  await expect(inqBtn).toBeVisible();
});

test('Quote Builder is accessible', async ({ page }) => {
  // Quote Builder has no nav_v2 button — verify page is reachable via showPage()
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('quotes');
  });
  await expect(page.locator('#page-quotes')).toBeVisible({ timeout: 5000 });
});

test('Calendar nav button is present', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  const calBtn = page.locator('[data-page="calendar"]').first();
  await expect(calBtn).toBeVisible();
});

test('Calendar page has Day/Week/Month view switchers', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('calendar');
  });
  await expect(page.locator('#page-calendar')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#cal-view-day')).toBeVisible();
  await expect(page.locator('#cal-view-week')).toBeVisible();
  await expect(page.locator('#cal-view-month')).toBeVisible();
});

test('Pipeline page is active on load', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#page-pipeline')).toBeVisible();
});
