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
  const inqBtn = page.locator('.nav-item', { hasText: 'Inquiries' });
  await expect(inqBtn).toBeVisible();
});

test('Quote Builder nav button is present', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  const quoteBtn = page.locator('.nav-item', { hasText: 'Quote Builder' });
  await expect(quoteBtn).toBeVisible();
});

test('Calendar nav button is present', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  const calBtn = page.locator('.nav-item', { hasText: 'Calendar' });
  await expect(calBtn).toBeVisible();
});

test('Calendar page has Day/Week/Month view switchers', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  await page.locator('.nav-item', { hasText: 'Calendar' }).click();
  await expect(page.locator('#page-calendar')).toBeVisible();
  await expect(page.locator('#cal-view-day')).toBeVisible();
  await expect(page.locator('#cal-view-week')).toBeVisible();
  await expect(page.locator('#cal-view-month')).toBeVisible();
});

test('Pipeline page is active on load', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#page-pipeline')).toBeVisible();
});
