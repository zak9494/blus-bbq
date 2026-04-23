// @ts-check
// Journey tests — Wave 1: Today's Actions widget
// Verifies: container present, renders rows from pipeline cache,
//           empty-state message, flag-gate hides widget.
// Viewports: 375 (iPhone), 768 (iPad), 1280 (desktop) × light + dark.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-wave1-todays-actions');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];
const THEMES = ['light', 'dark'];

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

function baseFlags(extras = []) {
  return JSON.stringify({ flags: [
    { name: 'nav_v2',                enabled: true,  description: '' },
    { name: 'ios_polish_v1',         enabled: true,  description: '' },
    { name: 'kanban_restructure',    enabled: true,  description: '' },
    { name: 'todays_actions_widget', enabled: true,  description: '' },
    ...extras,
  ]});
}

async function setupMocks(page, inquiries = []) {
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: baseFlags() }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries, total: inquiries.length }) }));
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

// ── Container present on pipeline page ───────────────────────────────────────
test.describe("Today's Actions — container present", () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`container in DOM — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        // navigate to pipeline
        await page.evaluate(() => typeof showPage === 'function' && showPage('pipeline'));
        const container = page.locator('#todays-actions-container');
        await expect(container).toBeAttached();
        await page.screenshot({ path: `${OUT}/container-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Empty state ───────────────────────────────────────────────────────────────
test.describe("Today's Actions — empty state", () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`shows empty message when no actions — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // No approved inquiries with action items
        await setupMocks(page, []);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.evaluate(() => typeof showPage === 'function' && showPage('pipeline'));
        await page.waitForTimeout(300);
        const container = page.locator('#todays-actions-container');
        const text = await container.textContent();
        expect(text).toContain('All clear for today');
        await page.screenshot({ path: `${OUT}/empty-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Overdue follow-up row renders ─────────────────────────────────────────────
test.describe("Today's Actions — overdue follow-up row", () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`shows overdue row when has_unreviewed_update — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const inqs = [
          { threadId: 'test-tda-001', customer_name: 'Jane Doe', from: 'jane@test.com',
            status: 'quote_sent', event_date: '2026-06-01', guest_count: 50,
            approved: true, has_unreviewed_update: true },
        ];
        await setupMocks(page, inqs);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.evaluate(() => typeof showPage === 'function' && showPage('pipeline'));
        await page.waitForTimeout(500);
        const container = page.locator('#todays-actions-container');
        const text = await container.textContent();
        expect(text).toContain('Jane Doe');
        expect(text).not.toContain('All clear for today');
        await page.screenshot({ path: `${OUT}/overdue-row-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Today's event row renders ─────────────────────────────────────────────────
test.describe("Today's Actions — today's event row", () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`shows event row for today's booked event — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const inqs = [
          { threadId: 'test-tda-002', customer_name: 'Bob Smith', from: 'bob@test.com',
            status: 'booked', event_date: TODAY, guest_count: 80,
            approved: true, has_unreviewed_update: false },
        ];
        await setupMocks(page, inqs);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.evaluate(() => typeof showPage === 'function' && showPage('pipeline'));
        await page.waitForTimeout(500);
        const container = page.locator('#todays-actions-container');
        const text = await container.textContent();
        expect(text).toContain('Bob Smith');
        await page.screenshot({ path: `${OUT}/event-row-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Flag OFF hides widget ─────────────────────────────────────────────────────
test.describe("Today's Actions — flag gate", () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) { // iphone + desktop
    test(`widget hidden when flag OFF — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.route('**/api/flags', r =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
          { name: 'nav_v2', enabled: true, description: '' },
          { name: 'todays_actions_widget', enabled: false, description: '' },
        ]}) }));
      await page.route('**/api/**', r =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => typeof showPage === 'function' && showPage('pipeline'));
      await page.waitForTimeout(300);
      const container = page.locator('#todays-actions-container');
      // When flag is off, widget should be hidden (display:none)
      const display = await container.evaluate(el => window.getComputedStyle(el).display);
      expect(display).toBe('none');
    });
  }
});
