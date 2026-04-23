// @ts-check
// Journey tests — Wave 1: Kanban card status dropdown
// Verifies: select present on every kanban card, changing to non-declined
//           status fires statusSync, changing to declined opens BottomSheet.
// Viewports: 375, 768, 1280 × light + dark.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-wave1-kanban-dropdown');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];
const THEMES = ['light', 'dark'];

// threadId must NOT start with 'test-' — pipelineInqCache filters those out
const SAMPLE_INQ = {
  threadId: 'wave1-kd-001', customer_name: 'Alice Kanban', from: 'alice@example.com',
  status: 'needs_info', event_date: '2026-07-10', guest_count: 60,
  approved: true, has_unreviewed_update: false,
};

async function setupMocks(page) {
  // Catch-all FIRST — specific routes registered after override it (last-registered wins)
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [SAMPLE_INQ], total: 1 }) }));
  await page.route('**/api/inquiries/save**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/pipeline/customer-history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'none' }) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tags: [] }) }));
  await page.route('**/api/settings/lost-reasons**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, reasons: ['Budget too high', 'Competitor', 'No response from customer', 'Event cancelled', 'Other'] }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',              enabled: true, description: '' },
      { name: 'kanban_restructure',  enabled: true, description: '' },
      { name: 'ios_polish_v1',       enabled: true, description: '' },
      { name: 'lost_reason_capture', enabled: true, description: '' },
    ]}) }));
}

async function waitForKanbanCard(page) {
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('pipeline');
  });
  await page.waitForSelector('.kb-status-sel', { timeout: 15000 });
}

// ── Select element present on every kanban card ───────────────────────────────
test.describe('Kanban dropdown — select present on cards', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`kb-status-sel present — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await waitForKanbanCard(page);
        const sel = page.locator('.kb-status-sel').first();
        await expect(sel).toBeAttached();
        await page.screenshot({ path: `${OUT}/select-present-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Changing to non-declined status fires save ────────────────────────────────
test.describe('Kanban dropdown — status change fires save', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`select change triggers API save — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        let saveHit = false;
        await setupMocks(page);
        await page.route('**/api/inquiries/save**', async r => {
          saveHit = true;
          await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await waitForKanbanCard(page);
        const sel = page.locator('.kb-status-sel').first();
        await expect(sel).toBeAttached();
        await sel.selectOption('booked');
        await page.waitForTimeout(400);
        expect(saveHit).toBe(true);
        await page.screenshot({ path: `${OUT}/save-fired-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Moving to declined opens BottomSheet ──────────────────────────────────────
test.describe('Kanban dropdown — declined opens BottomSheet', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`BottomSheet visible after selecting Lost — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await waitForKanbanCard(page);
        const sel = page.locator('.kb-status-sel').first();
        await expect(sel).toBeAttached();
        await sel.selectOption('declined');
        await page.waitForTimeout(500);
        // BottomSheet panel should be visible
        const panel = page.locator('#bottom-sheet-panel.bs-open');
        await expect(panel).toBeVisible({ timeout: 4000 });
        // Title should be lost-related
        const title = await page.locator('#bottom-sheet-title').textContent();
        expect(title?.toLowerCase()).toContain('lost');
        await page.screenshot({ path: `${OUT}/declined-sheet-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});
