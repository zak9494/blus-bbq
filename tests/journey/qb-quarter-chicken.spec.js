// @ts-check
// Journey tests — Quote Builder: Quarter Chicken requires 3+ meats.
// Verifies that the chicken-quarter checkbox is gated by the count of
// other selected meats: disabled at 0, 1, 2 meats; enabled at 3+; cleared
// when meats drop back below 3.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-qb-quarter-chicken');
fs.mkdirSync(OUT, { recursive: true });

async function setupMocks(page) {
  // Catch-all FIRST — specific routes registered after override (last-registered wins).
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'qb_quarter_chicken_3meat', enabled: true, description: '' },
    ]}) }));
}

async function gotoQuoteBuilder(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (window.qbQuarterChickenGate) window.qbQuarterChickenGate.init();
    if (typeof showPage === 'function') showPage('quotes');
  });
  await page.waitForSelector('#menu-meats input[data-id="chicken-quarter"]', { timeout: 15000 });
}

function quarterCb(page) {
  return page.locator('#menu-meats input[data-id="chicken-quarter"]');
}

function meatCb(page, id) {
  return page.locator(`#menu-meats input[data-id="${id}"]`);
}

test.describe('Quote Builder — quarter chicken gating', () => {
  test('default state (0 meats): quarter chicken disabled', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await gotoQuoteBuilder(page);
    const qcb = quarterCb(page);
    await expect(qcb).toBeAttached();
    await expect(qcb).toBeDisabled();
    await page.screenshot({ path: `${OUT}/01-zero-meats-disabled.png`, fullPage: false });
  });

  test('two meats: still disabled', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await gotoQuoteBuilder(page);
    await meatCb(page, 'brisket-sliced').check();
    await meatCb(page, 'pulled-pork').check();
    await page.waitForTimeout(50);
    const qcb = quarterCb(page);
    await expect(qcb).toBeDisabled();
    await page.screenshot({ path: `${OUT}/02-two-meats-disabled.png`, fullPage: false });
  });

  test('three meats: becomes enabled and selectable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await gotoQuoteBuilder(page);
    await meatCb(page, 'brisket-sliced').check();
    await meatCb(page, 'pulled-pork').check();
    await meatCb(page, 'turkey').check();
    await page.waitForTimeout(50);
    const qcb = quarterCb(page);
    await expect(qcb).toBeEnabled();
    await qcb.check();
    await expect(qcb).toBeChecked();
    await page.screenshot({ path: `${OUT}/03-three-meats-enabled.png`, fullPage: false });
  });

  test('drop back to two meats: disabled again and quarter chicken cleared', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await gotoQuoteBuilder(page);
    await meatCb(page, 'brisket-sliced').check();
    await meatCb(page, 'pulled-pork').check();
    await meatCb(page, 'turkey').check();
    await page.waitForTimeout(50);
    const qcb = quarterCb(page);
    await expect(qcb).toBeEnabled();
    await qcb.check();
    await expect(qcb).toBeChecked();
    // Remove one meat → count = 2
    await meatCb(page, 'turkey').uncheck();
    await page.waitForTimeout(50);
    await expect(qcb).toBeDisabled();
    await expect(qcb).not.toBeChecked();
    await page.screenshot({ path: `${OUT}/04-dropped-to-two-cleared.png`, fullPage: false });
  });

  test('flag OFF: quarter chicken row hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // override the flags route to set this single flag OFF
    await page.route('**/api/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/auth/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
    await page.route('**/api/notifications/counts', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
    await page.route('**/api/inquiries/list*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
    await page.route('**/api/flags', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
        { name: 'qb_quarter_chicken_3meat', enabled: false, description: '' },
      ]}) }));
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await page.evaluate(async () => {
      if (window.flags) await window.flags.load();
      if (window.qbQuarterChickenGate) window.qbQuarterChickenGate.init();
      if (typeof showPage === 'function') showPage('quotes');
    });
    // checkbox still rendered (menu source-of-truth includes it) but row is display:none
    const qcb = quarterCb(page);
    await expect(qcb).toBeAttached();
    const visible = await qcb.evaluate(el => {
      const row = el.closest('.menu-item-check')?.parentElement;
      return row ? getComputedStyle(row).display !== 'none' : false;
    });
    expect(visible).toBe(false);
    await page.screenshot({ path: `${OUT}/05-flag-off-hidden.png`, fullPage: false });
  });
});
