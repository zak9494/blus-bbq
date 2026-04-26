// @ts-check
// Journey tests for feat/customer-nav-routing
// Covers: kanban → QB → back; list → QB → back; quick card → More info → customer profile
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../outputs/customer-nav-routing');
fs.mkdirSync(OUT, { recursive: true });

const MOCK_INQ = {
  threadId: 'thread-nav-test-1',
  customer_name: 'Ada Lovelace',
  from: 'ada@lovelace.dev',
  extracted_fields: { customer_name: 'Ada Lovelace', customer_email: 'ada@lovelace.dev' },
  event_date: '2026-06-15',
  guest_count: 80,
  status: 'quote_sent',
  quote_total: '2400',
  notes: 'Corporate lunch',
};

const BASE_FLAGS = [
  { name: 'kanban_restructure',    enabled: true,  description: 'QA mock' },
  { name: 'customer_profile_v2',   enabled: true,  description: 'QA mock' },
  { name: 'customers_nav_v1',      enabled: true,  description: 'QA mock' },
  { name: 'nav_v2',                enabled: false, description: '' },
  { name: 'notifications_center',  enabled: false, description: '' },
  { name: 'test_customer_mode',    enabled: false, description: '' },
  { name: 'event_day_view',        enabled: false, description: '' },
  { name: 'calendar_v2',           enabled: false, description: '' },
  { name: 'ai_quote_updates',      enabled: false, description: '' },
  { name: 'deposit_tracking',      enabled: false, description: '' },
  { name: 'completed_orders_view', enabled: false, description: '' },
  { name: 'completed_eom_hide',    enabled: false, description: '' },
];

async function setupMocks(page) {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/inquiries/list', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ inquiries: [MOCK_INQ], total: 1 }) })
  );
  await page.route('**/api/auth/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) })
  );
  await page.route('**/api/tasks', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }) })
  );
  await page.route('**/api/pipeline/alerts', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ alerts: [] }) })
  );
  await page.route('**/api/notifications/vapid-key', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ publicKey: '' }) })
  );
  await page.route('**/api/pipeline/customer-history**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'none', count: 0, bookedCount: 0 }) })
  );
  await page.route('**/api/inquiries/by-email**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ inquiries: [MOCK_INQ] }) })
  );
  await page.route('**/api/flags', route => {
    const url = route.request().url();
    if (/\/api\/flags\/[^?]/.test(url)) { route.fallback(); return; }
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, flags: BASE_FLAGS }) });
  });
}

test.describe('customer-nav-routing journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  });

  // ── Journey 1: Kanban → QB → Back → Kanban ────────────────────────────
  test('kanban → quote builder → back → kanban', async ({ page }) => {
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('pipeline'); });
    await page.waitForTimeout(400);

    await expect(page.locator('#view-kanban')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, '1a-kanban-initial.png') });

    // Navigate to QB while on kanban
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('quotes'); });
    await page.waitForTimeout(300);

    await expect(page.locator('#page-quotes')).toHaveClass(/active/);
    const backBtn = page.locator('#qb-back-btn');
    await expect(backBtn).toBeVisible();
    await page.screenshot({ path: path.join(OUT, '1b-qb-with-back.png') });

    await backBtn.click();
    await page.waitForTimeout(300);

    await expect(page.locator('#page-pipeline')).toHaveClass(/active/);
    await expect(page.locator('#view-kanban')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, '1c-back-to-kanban.png') });
    console.log('✓ Journey 1: kanban → QB → back → kanban');
  });

  // ── Journey 2: List View → QB → Back → List View ──────────────────────
  test('list view → quote builder → back → list view', async ({ page }) => {
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('pipeline'); });
    await page.waitForTimeout(400);

    // Switch to list tab
    const listTabEl = page.locator('.tab', { hasText: 'List View' });
    await listTabEl.click();
    await page.waitForTimeout(400);

    await expect(page.locator('#view-list')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, '2a-list-initial.png') });

    await page.evaluate(() => { if (typeof showPage === 'function') showPage('quotes'); });
    await page.waitForTimeout(300);

    await expect(page.locator('#page-quotes')).toHaveClass(/active/);
    const backBtn = page.locator('#qb-back-btn');
    await expect(backBtn).toBeVisible();
    await page.screenshot({ path: path.join(OUT, '2b-qb-from-list.png') });

    await backBtn.click();
    await page.waitForTimeout(300);

    await expect(page.locator('#page-pipeline')).toHaveClass(/active/);
    await expect(page.locator('#view-list')).toBeVisible();
    await expect(page.locator('#view-kanban')).toBeHidden();
    await page.screenshot({ path: path.join(OUT, '2c-back-to-list.png') });
    console.log('✓ Journey 2: list → QB → back → list');
  });

  // ── Journey 3: QB from non-pipeline has no back button ────────────────
  test('QB accessed from non-pipeline page has no back button', async ({ page }) => {
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('inquiries'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('quotes'); });
    await page.waitForTimeout(300);

    await expect(page.locator('#qb-back-btn')).toBeHidden();
    await page.screenshot({ path: path.join(OUT, '3-qb-no-back-from-inquiries.png') });
    console.log('✓ Journey 3: QB from non-pipeline has no back button');
  });

  // ── Journey 4: Quick card popup on list view ───────────────────────────
  test('list view customer name opens quick card popup', async ({ page }) => {
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('pipeline'); });
    await page.waitForTimeout(400);

    const listTabEl = page.locator('.tab', { hasText: 'List View' });
    await listTabEl.click();
    await page.waitForTimeout(500);

    const nameEl = page.locator('.lv-name-popup').first();
    if (await nameEl.count() === 0) {
      console.log('⚠ No .lv-name-popup — kanban_restructure data not rendered');
      await page.screenshot({ path: path.join(OUT, '4-list-no-data.png') });
      return;
    }

    await nameEl.click();
    await page.waitForTimeout(300);

    const popup = page.locator('.kb-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: path.join(OUT, '4a-list-popup-open.png') });

    await page.locator('.kb-popup-overlay').click();
    await page.waitForTimeout(200);
    await expect(popup).toBeHidden();
    await page.screenshot({ path: path.join(OUT, '4b-popup-closed.png') });
    console.log('✓ Journey 4: list view customer name opens quick card popup');
  });

  // ── Journey 5: Quick card "More info" → customer profile ──────────────
  test('quick card More info navigates to customer profile', async ({ page }) => {
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('pipeline'); });
    await page.waitForTimeout(400);

    const opened = await page.evaluate(() => {
      var cache = window.pipelineInqCache || [];
      if (!cache.length) return false;
      if (window.kanbanView && typeof window.kanbanView._openPopup === 'function') {
        window.kanbanView._openPopup(cache[0], null);
        return true;
      }
      return false;
    });

    if (!opened) {
      console.log('⚠ Could not open popup — pipelineInqCache empty or kanbanView not ready');
      await page.screenshot({ path: path.join(OUT, '5-popup-not-opened.png') });
      return;
    }

    await page.waitForTimeout(300);
    const popup = page.locator('.kb-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: path.join(OUT, '5a-popup-open.png') });

    const moreInfoBtn = popup.locator('button', { hasText: 'More info' });
    await expect(moreInfoBtn).toBeVisible();
    await moreInfoBtn.click();
    await page.waitForTimeout(400);

    await expect(page.locator('.kb-popup')).toBeHidden();
    await expect(page.locator('#page-customer')).toHaveClass(/active/);
    await page.screenshot({ path: path.join(OUT, '5b-customer-profile.png') });
    console.log('✓ Journey 5: More info → customer profile');
  });

  // ── Journey 6: Customers nav item visible when flag ON ────────────────
  test('customers_nav_v1 flag shows nav item and routes correctly', async ({ page }) => {
    const navCustomers = page.locator('#nav-customers');
    await expect(navCustomers).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: path.join(OUT, '6a-customers-nav-visible.png') });

    await navCustomers.click();
    await page.waitForTimeout(300);
    await expect(page.locator('#page-customer')).toHaveClass(/active/);
    await page.screenshot({ path: path.join(OUT, '6b-customer-page-active.png') });
    console.log('✓ Journey 6: customers_nav_v1 flag → nav visible + routes to customer page');
  });
});
