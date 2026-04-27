// @ts-check
// Core smoke tests — page load, navigation, primary views.
// Migrated from tests/smoke.spec.js.
//
// Flag dependencies: nav_v2 controls whether the inquiries / calendar nav
// buttons are rendered as `[data-page="..."]` (nav_v2 ON) or `.nav-item`
// (nav_v2 OFF). These specs assert the BEHAVIOR with nav_v2 ON, so they mock
// the flag rather than depending on prod KV state. See PR #122 for the drift
// incident that motivated this.
const { test, expect } = require('@playwright/test');
const { mockFlagState } = require('../helpers/mock-flags');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';

test('homepage loads (HTTP 200)', async ({ request }) => {
  const res = await request.get(BASE_URL);
  expect(res.status()).toBe(200);
});

test('Inquiries nav button is present', async ({ page }) => {
  await mockFlagState(page, { nav_v2: true });
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  // nav_v2 ON: [data-page] buttons in sidebar; old .nav-item is hidden
  const inqBtn = page.locator('[data-page="inquiries"]').first();
  await expect(inqBtn).toBeVisible();
});

test('Quote Builder is accessible', async ({ page }) => {
  // Quote Builder has no nav_v2 button — verify page is reachable via showPage()
  await mockFlagState(page, { nav_v2: true });
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('quotes');
  });
  await expect(page.locator('#page-quotes')).toBeVisible({ timeout: 5000 });
});

test('Calendar nav button is present', async ({ page }) => {
  await mockFlagState(page, { nav_v2: true });
  await page.goto(BASE_URL);
  await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
  const calBtn = page.locator('[data-page="calendar"]').first();
  await expect(calBtn).toBeVisible();
});

test('Calendar page has Day/Week/Month view switchers', async ({ page }) => {
  await mockFlagState(page, { nav_v2: true });
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
