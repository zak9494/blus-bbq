// @ts-check
// Journey tests — Wave 1: Lost-reason BottomSheet
// Verifies: lostReasonSheet module loaded, BottomSheet opens on declined,
//           reason buttons render, skip path works, settings editor present.
// Viewports: 375, 768, 1280 × light + dark.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-wave1-lost-reason');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];
const THEMES = ['light', 'dark'];

const SAMPLE_INQ = {
  threadId: 'test-lr-001', customer_name: 'Lost Lead', from: 'lost@test.com',
  status: 'quote_sent', event_date: '2026-08-01', guest_count: 40,
  approved: true, has_unreviewed_update: false,
};

const DEFAULT_REASONS = ['Budget too high', 'Competitor', 'No response from customer', 'Event cancelled', 'Other'];

async function setupMocks(page) {
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',              enabled: true, description: '' },
      { name: 'kanban_restructure',  enabled: true, description: '' },
      { name: 'ios_polish_v1',       enabled: true, description: '' },
      { name: 'lost_reason_capture', enabled: true, description: '' },
    ]}) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [SAMPLE_INQ], total: 1 }) }));
  await page.route('**/api/settings/lost-reasons**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, reasons: DEFAULT_REASONS }) }));
  await page.route('**/api/inquiries/save**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/pipeline/customer-history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'none' }) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tags: [] }) }));
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

// ── lostReasonSheet module loaded ─────────────────────────────────────────────
test.describe('Lost reason — module loaded', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`window.lostReasonSheet defined — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        const hasModule = await page.evaluate(() => typeof window.lostReasonSheet !== 'undefined');
        expect(hasModule).toBe(true);
        await page.screenshot({ path: `${OUT}/module-loaded-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── BottomSheet opens when lostReasonSheet.open() called ─────────────────────
test.describe('Lost reason — BottomSheet opens', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`BottomSheet panel visible after open() — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        // Directly call lostReasonSheet.open() to test it in isolation
        await page.evaluate(() => {
          if (window.lostReasonSheet) {
            window.lostReasonSheet.open('test-lr-001', function() {}, function() {});
          }
        });
        await page.waitForTimeout(400);
        const panel = page.locator('#bottom-sheet-panel.bs-open');
        await expect(panel).toBeVisible();
        const title = await page.locator('#bottom-sheet-title').textContent();
        expect(title?.toLowerCase()).toContain('lost');
        await page.screenshot({ path: `${OUT}/sheet-open-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Reason buttons rendered in BottomSheet ────────────────────────────────────
test.describe('Lost reason — reason buttons in sheet', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`reason options appear — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.evaluate(() => {
          if (window.lostReasonSheet) window.lostReasonSheet.open('test-lr-001', function() {}, function() {});
        });
        // Wait for async reason fetch + DOM swap
        await page.waitForTimeout(700);
        const buttons = page.locator('.lrs-btn');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
        await page.screenshot({ path: `${OUT}/reason-btns-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Skip button closes sheet without saving reason ────────────────────────────
test.describe('Lost reason — skip path', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`Skip calls onConfirm(null) and closes sheet — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        const confirmedWith = await page.evaluate(() => new Promise(resolve => {
          if (!window.lostReasonSheet) return resolve('no-module');
          window.lostReasonSheet.open('test-lr-001', r => resolve(r === null ? 'null' : String(r)), function() {});
          // Click Skip after a tick
          setTimeout(() => {
            const skipBtn = Array.from(document.querySelectorAll('.bs-btn')).find(b => b.textContent === 'Skip');
            if (skipBtn) skipBtn.click();
          }, 600);
        }));
        expect(confirmedWith).toBe('null');
        await page.waitForTimeout(200);
        const panel = page.locator('#bottom-sheet-panel.bs-open');
        await expect(panel).not.toBeVisible();
        await page.screenshot({ path: `${OUT}/skip-closed-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Settings page has Lost Reasons editor ─────────────────────────────────────
test.describe('Lost reason — settings editor', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`settings-lost-reasons-editor present on settings page — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await page.evaluate(() => typeof showPage === 'function' && showPage('settings'));
        await page.waitForTimeout(500);
        const editor = page.locator('#settings-lost-reasons-editor');
        await expect(editor).toBeAttached();
        // Editor should show loaded reasons
        const text = await editor.textContent();
        expect(text).toContain('Budget too high');
        await page.screenshot({ path: `${OUT}/settings-editor-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});
