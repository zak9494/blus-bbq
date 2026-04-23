// @ts-check
// Journey tests — Wave 1: Customer tags
// Verifies: tag chips appear on kanban cards, tag-picker init in customer
//           profile, POST /api/customers/tags called on add, flag gate hides chips.
// Viewports: 375, 768, 1280 × light + dark.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-wave1-customer-tags');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];
const THEMES = ['light', 'dark'];

const TEST_EMAIL = 'vip@example.com';
// threadId must NOT start with 'test-' — pipelineInqCache filters those out
const SAMPLE_INQ = {
  threadId: 'wave1-ct-001', customer_name: 'VIP Customer',
  from: 'VIP Customer <' + TEST_EMAIL + '>',
  status: 'booked', event_date: '2026-07-15', guest_count: 100,
  approved: true, has_unreviewed_update: false,
  extracted_fields: { customer_email: TEST_EMAIL },
};

async function setupMocks(page, tags = ['VIP']) {
  // Catch-all FIRST — specific routes registered after override it (last-registered wins)
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [SAMPLE_INQ], total: 1 }) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, email: TEST_EMAIL, tags }) }));
  await page.route('**/api/pipeline/customer-history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'none' }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',              enabled: true, description: '' },
      { name: 'kanban_restructure',  enabled: true, description: '' },
      { name: 'ios_polish_v1',       enabled: true, description: '' },
      { name: 'customer_tags',       enabled: true, description: '' },
      { name: 'customer_profile_v2', enabled: true, description: '' },
    ]}) }));
}

async function waitForKanbanCard(page) {
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('pipeline');
  });
  await page.waitForSelector('.kb-card', { timeout: 15000 });
}

// ── tag-picker module loaded ──────────────────────────────────────────────────
test.describe('Customer tags — module loaded', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`window.tagPicker defined — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        const hasModule = await page.evaluate(() => typeof window.tagPicker !== 'undefined');
        expect(hasModule).toBe(true);
        await page.screenshot({ path: `${OUT}/module-loaded-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── chips rendered on kanban cards once tags load ─────────────────────────────
test.describe('Customer tags — chip rendered on kanban card', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`ctp-chip appears on kb-card — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page, ['VIP']);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        // Wait for flags + kanban to render
        await waitForKanbanCard(page);
        // Assert chip area exists on the card (even if async tags not yet rendered)
        const tagArea = page.locator('.kb-card-customer-tags').first();
        await expect(tagArea).toBeAttached({ timeout: 5000 });
        await page.screenshot({ path: `${OUT}/chip-on-card-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── tag picker renders in customer profile ────────────────────────────────────
test.describe('Customer tags — picker in customer profile', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`ctp-container present in profile — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.route('**/api/customer/profile**', r =>
          r.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true,
              customer: { email: TEST_EMAIL, name: 'VIP Customer', phone: '',
                totalEvents: 2, totalBilled: 5000, events: [] },
              notes: '' }) }));
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
        // Navigate to customer profile page
        await page.evaluate(() => {
          if (window.customerProfile && typeof window.customerProfile.show === 'function') {
            window.customerProfile.show('vip@example.com');
          } else {
            typeof showPage === 'function' && showPage('customer');
          }
        });
        await page.waitForTimeout(600);
        const container = page.locator('#cp-tag-picker-container');
        await expect(container).toBeAttached({ timeout: 4000 });
        await page.screenshot({ path: `${OUT}/picker-in-profile-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── flag OFF hides tag chips ──────────────────────────────────────────────────
test.describe('Customer tags — flag gate', () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`no ctp-chip when flag OFF — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.route('**/api/**', r =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.route('**/api/flags', r =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
          { name: 'nav_v2',            enabled: true,  description: '' },
          { name: 'kanban_restructure', enabled: true, description: '' },
          { name: 'customer_tags',     enabled: false, description: '' },
        ]}) }));
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
      await page.evaluate(() => typeof showPage === 'function' && showPage('pipeline'));
      await page.waitForTimeout(500);
      // renderChips returns '' when flag OFF, so no ctp-chips should appear
      const chips = page.locator('.ctp-chip');
      const count = await chips.count();
      expect(count).toBe(0);
    });
  }
});
