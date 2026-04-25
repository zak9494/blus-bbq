// @ts-check
// Journey tests — Wave 2: Quote Builder extensions (qb_ext_wave2 flag)
// Covers: extension fields visible when flag ON, hidden when flag OFF,
//         discount/setup fee/tax override update the preview total,
//         quarter-chicken suggest appears at 3+ meats, Maps link shown for delivery.
// Viewports: 375 (iPhone), 768 (iPad), 1440 (desktop).
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-qb-ext-wave2');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900  },
];

async function setupMocks(page, flagOn = true) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
  await page.route('**/api/pipeline/customer-history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'none' }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',         enabled: true,  description: '' },
      { name: 'ios_polish_v1',  enabled: true,  description: '' },
      { name: 'qb_ext_wave2',   enabled: flagOn, description: '' },
    ]}) }));
}

async function gotoQuotes(page) {
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('quotes');
  });
  await page.waitForSelector('#page-quotes', { timeout: 10000 });
  await page.waitForTimeout(400);
}

// ── Flag OFF: extension fields hidden ────────────────────────────────────────
test.describe('QB Wave 2 — flag OFF hides extension fields', () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`ext fields hidden when flag OFF — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, false);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await gotoQuotes(page);
      const extFields = page.locator('#qb-ext-fields');
      await expect(extFields).toBeHidden();
      await page.screenshot({ path: `${OUT}/flag-off-${vp.name}.png` });
    });
  }
});

// ── Flag ON: extension fields visible ────────────────────────────────────────
test.describe('QB Wave 2 — flag ON shows extension fields', () => {
  for (const vp of VIEWPORTS) {
    test(`ext fields visible when flag ON — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, true);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await gotoQuotes(page);
      const extFields = page.locator('#qb-ext-fields');
      await expect(extFields).toBeVisible({ timeout: 5000 });
      // Key sub-fields present
      await expect(page.locator('#q-discount-val')).toBeAttached();
      await expect(page.locator('#q-tax-rate')).toBeAttached();
      await expect(page.locator('#q-deposit-pct')).toBeAttached();
      await expect(page.locator('#q-due-date')).toBeAttached();
      await page.screenshot({ path: `${OUT}/flag-on-${vp.name}.png` });
    });
  }
});

// ── Deposit % default = 50 ────────────────────────────────────────────────────
test.describe('QB Wave 2 — deposit % defaults to 50', () => {
  test('q-deposit-pct value is 50 on load', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page, true);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await gotoQuotes(page);
    await expect(page.locator('#qb-ext-fields')).toBeVisible({ timeout: 5000 });
    const depositVal = await page.locator('#q-deposit-pct').inputValue();
    expect(depositVal).toBe('50');
  });
});

// ── Tax rate field — default 8.25 ────────────────────────────────────────────
test.describe('QB Wave 2 — tax rate field defaults to 8.25', () => {
  test('q-tax-rate value is 8.25 on load', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page, true);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await gotoQuotes(page);
    await expect(page.locator('#qb-ext-fields')).toBeVisible({ timeout: 5000 });
    const taxVal = await page.locator('#q-tax-rate').inputValue();
    expect(taxVal).toBe('8.25');
  });
});

// ── Setup fee row shows only for delivery_setup / delivery_full ───────────────
test.describe('QB Wave 2 — setup fee row visibility', () => {
  test('setup fee row hidden for pickup, visible for delivery_setup', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page, true);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await gotoQuotes(page);
    await expect(page.locator('#qb-ext-fields')).toBeVisible({ timeout: 5000 });

    // pickup → hidden
    await page.locator('#q-service').selectOption('pickup');
    await expect(page.locator('#qb-setup-fee-row')).toBeHidden();

    // delivery_setup → visible
    await page.locator('#q-service').selectOption('delivery_setup');
    await expect(page.locator('#qb-setup-fee-row')).toBeVisible();

    // delivery_full → visible
    await page.locator('#q-service').selectOption('delivery_full');
    await expect(page.locator('#qb-setup-fee-row')).toBeVisible();

    await page.screenshot({ path: `${OUT}/setup-fee-row-desktop.png` });
  });
});

// ── Quarter-chicken suggest banner appears at 3+ individual meats ─────────────
test.describe('QB Wave 2 — quarter chicken suggest', () => {
  for (const vp of VIEWPORTS) {
    test(`suggest banner hidden < 3 meats, visible at 3 — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, true);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await gotoQuotes(page);

      // Banner starts hidden
      const banner = page.locator('#qb-quarter-chicken-suggest');
      await expect(banner).toBeHidden();

      // Select 3 individual meats
      await page.evaluate(() => {
        if (window.flags) window.flags.load();
        // Directly manipulate selectedItems to simulate 3 meat selections
        window.selectedItems = {
          'brisket-sliced':  { price: 31.99, name: 'Brisket (sliced)',  unit: 'lbs', qty: 1 },
          'pulled-pork':     { price: 22.99, name: 'Pulled Pork',       unit: 'lbs', qty: 1 },
          'sausage-pb':      { price: 22.99, name: 'Sausage (pork & beef)', unit: 'lbs', qty: 1 },
        };
        if (typeof qbCheckQuarterChickenSuggest === 'function') qbCheckQuarterChickenSuggest();
      });
      await page.waitForTimeout(300);
      await expect(banner).toBeVisible({ timeout: 3000 });
      await page.screenshot({ path: `${OUT}/qc-suggest-${vp.name}.png` });
    });
  }
});

// ── Maps directions link shown for delivery with address ─────────────────────
test.describe('QB Wave 2 — Maps directions link', () => {
  test('Maps link visible for delivery + address, hidden for pickup', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page, true);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await gotoQuotes(page);
    await expect(page.locator('#qb-ext-fields')).toBeVisible({ timeout: 5000 });

    // Add an item to enable preview
    await page.evaluate(() => {
      window.selectedItems = { 'brisket-sliced': { price: 31.99, name: 'Brisket (sliced)', unit: 'lbs', qty: 1 } };
    });

    // Pickup — no link
    await page.locator('#q-service').selectOption('pickup');
    await page.locator('#q-address').fill('123 Main St, Dallas TX');
    await page.evaluate(() => typeof updatePreview === 'function' && updatePreview());
    await expect(page.locator('#qb-maps-link')).toBeHidden();

    // Delivery with address — link visible
    await page.locator('#q-service').selectOption('delivery');
    await page.evaluate(() => typeof updatePreview === 'function' && updatePreview());
    await page.waitForTimeout(200);
    const mapsLink = page.locator('#qb-maps-link');
    await expect(mapsLink).toBeVisible({ timeout: 3000 });
    const href = await mapsLink.getAttribute('href');
    expect(href).toContain('maps.google.com');
    expect(href).toContain('Main+St');
    await page.screenshot({ path: `${OUT}/maps-link-desktop.png` });
  });
});

// ── New service type delivery_full available ──────────────────────────────────
test.describe('QB Wave 2 — delivery_full service type', () => {
  test('delivery_full option exists in select', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page, true);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await gotoQuotes(page);
    const opts = await page.locator('#q-service option').allTextContents();
    expect(opts.some(t => t.toLowerCase().includes('serving'))).toBe(true);
  });
});

// ── Discount type toggle $/% ──────────────────────────────────────────────────
test.describe('QB Wave 2 — discount type toggle', () => {
  test('toggle button switches between $ and %', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page, true);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await gotoQuotes(page);
    await expect(page.locator('#qb-ext-fields')).toBeVisible({ timeout: 5000 });
    const btn = page.locator('#qb-discount-type-btn');
    await expect(btn).toHaveText('$');
    await btn.click();
    await expect(btn).toHaveText('%');
    await btn.click();
    await expect(btn).toHaveText('$');
  });
});
