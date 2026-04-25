// @ts-check
// Journey tests — Wave 1.5: Lost system
// Verifies: past-event pill on kanban + list, Mark Lost modal opens + confirms,
//           Lost Reasons widget renders breakdown.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-wave-1-5-lost-reasons');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

// Past-event inquiry: event_date yesterday, status not completed/declined
const YESTERDAY = (() => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
})();

const PAST_INQ = {
  threadId: 'thread-past-001',
  customer_name: 'Past Event Customer',
  from: 'past@example.com',
  status: 'quote_sent',
  approved: true,
  has_unreviewed_update: false,
  event_date: YESTERDAY,
  guest_count: 50,
  quote_total: '1200',
  created_at: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const LOST_REASONS_DATA = {
  total_count: 12,
  total_amount: 14400,
  from: '2026-03-25',
  to: '2026-04-25',
  by_reason: {
    booked_elsewhere:     { count: 4, amount: 5000, pct: 33 },
    budget_mismatch:      { count: 3, amount: 3600, pct: 25 },
    no_response_customer: { count: 3, amount: 3600, pct: 25 },
    other:                { count: 2, amount: 2200, pct: 17 },
  },
};

async function setupMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [PAST_INQ], total: 1 }) }));
  await page.route('**/api/pipeline/customer-history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'none' }) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tags: [] }) }));
  await page.route('**/api/pipeline/alerts**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [] }) }));
  await page.route('**/api/pipeline/overdue**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/invoices/lost-reasons**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LOST_REASONS_DATA) }));
  await page.route('**/api/orders/mark-lost**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, threadId: 'thread-past-001', status: 'declined', lost_reason: 'booked_elsewhere' }) }));
  await page.route('**/api/settings/lost-reasons**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reasons: [] }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',             enabled: true,  description: '' },
      { name: 'kanban_restructure', enabled: true,  description: '' },
      { name: 'ios_polish_v1',      enabled: true,  description: '' },
      { name: 'lost_reason_capture',enabled: true,  description: '' },
      { name: 'lost_reasons_v1',    enabled: true,  description: '' },
    ]}) }));
}

async function waitForFlags(page) {
  await page.waitForFunction(() => window.flags && typeof window.flags.isEnabled === 'function', { timeout: 5000 });
}

async function goToPipeline(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await waitForFlags(page);
  // Trigger pipeline load (flags must be ready first)
  await page.evaluate(() => {
    if (typeof window.loadPipelineInquiries === 'function') window.loadPipelineInquiries();
  });
  await page.waitForTimeout(600);
}

// ── 1. modules loaded ─────────────────────────────────────────────────────────
test.describe('Wave 1.5 — modules loaded', () => {
  test('markLostModal defined', async ({ page }) => {
    await setupMocks(page);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    const defined = await page.evaluate(() => typeof window.markLostModal !== 'undefined');
    expect(defined).toBe(true);
  });

  test('lostReasonsWidget defined', async ({ page }) => {
    await setupMocks(page);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    const defined = await page.evaluate(() => typeof window.lostReasonsWidget !== 'undefined');
    expect(defined).toBe(true);
  });
});

// ── 2. Past-event pill on kanban ──────────────────────────────────────────────
test.describe('Wave 1.5 — past-event pill on kanban', () => {
  for (const vp of VIEWPORTS) {
    test(`past-event pill visible — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await goToPipeline(page);

      const pill = page.locator('.kb-tag-past-event').first();
      await expect(pill).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: `${OUT}/kanban-past-event-pill-${vp.name}.png` });
    });

    test(`past-event card has red left border class — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await goToPipeline(page);

      const hasClass = await page.locator('.kb-card.kb-past-event').first().isVisible({ timeout: 5000 });
      expect(hasClass).toBe(true);
    });
  }
});

// ── 3. Mark Lost modal opens from kanban pill ─────────────────────────────────
test.describe('Wave 1.5 — Mark Lost modal from kanban', () => {
  test('modal opens and shows 7 reason buttons', async ({ page }) => {
    await setupMocks(page);
    await goToPipeline(page);

    const pill = page.locator('.kb-tag-past-event').first();
    await expect(pill).toBeVisible({ timeout: 5000 });
    await pill.click();

    const modal = page.locator('.mlm-sheet');
    await expect(modal).toBeVisible({ timeout: 3000 });

    const buttons = page.locator('.mlm-reason-btn');
    await expect(buttons).toHaveCount(7);
    await page.screenshot({ path: `${OUT}/mark-lost-modal-open.png` });
  });

  test('selecting reason enables Confirm + shows notes field', async ({ page }) => {
    await setupMocks(page);
    await goToPipeline(page);

    await page.locator('.kb-tag-past-event').first().click();
    await expect(page.locator('.mlm-sheet')).toBeVisible({ timeout: 3000 });

    const confirmBtn = page.locator('.mlm-btn-confirm');
    await expect(confirmBtn).toBeDisabled();

    await page.locator('.mlm-reason-btn[data-code="booked_elsewhere"]').click();
    await expect(confirmBtn).toBeEnabled();
    await expect(page.locator('.mlm-notes-wrap')).toBeVisible();
    await page.screenshot({ path: `${OUT}/mark-lost-modal-reason-selected.png` });
  });

  test('confirm calls /api/orders/mark-lost and closes modal', async ({ page }) => {
    await setupMocks(page);
    await goToPipeline(page);

    await page.locator('.kb-tag-past-event').first().click();
    await expect(page.locator('.mlm-sheet')).toBeVisible({ timeout: 3000 });

    await page.locator('.mlm-reason-btn[data-code="booked_elsewhere"]').click();
    await page.locator('.mlm-btn-confirm').click();

    // Modal should close after successful API call
    await expect(page.locator('.mlm-sheet')).not.toBeVisible({ timeout: 4000 });
    await page.screenshot({ path: `${OUT}/mark-lost-modal-after-confirm.png` });
  });

  test('cancel closes modal without submitting', async ({ page }) => {
    await setupMocks(page);
    await goToPipeline(page);

    await page.locator('.kb-tag-past-event').first().click();
    await expect(page.locator('.mlm-sheet')).toBeVisible({ timeout: 3000 });

    await page.locator('.mlm-btn-cancel').click();
    await expect(page.locator('.mlm-sheet')).not.toBeVisible({ timeout: 2000 });
  });
});

// ── 4. Past-event chip on list view ──────────────────────────────────────────
test.describe('Wave 1.5 — past-event chip on list view', () => {
  for (const vp of VIEWPORTS) {
    test(`past chip visible in list view — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await goToPipeline(page);

      // Switch to list view
      await page.evaluate(() => {
        if (typeof switchTab === 'function') switchTab('list', null);
        else if (window.listView && typeof window.listView.render === 'function') {
          const c = document.getElementById('view-list');
          if (c) window.listView.render(c, window.pipelineInqCache || []);
        }
      });
      await page.waitForTimeout(400);

      const chip = page.locator('.lv-chip-past-event').first();
      await expect(chip).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: `${OUT}/list-past-event-chip-${vp.name}.png` });
    });
  }
});

// ── 5. Lost Reasons widget renders ───────────────────────────────────────────
test.describe('Wave 1.5 — Lost Reasons widget', () => {
  for (const vp of VIEWPORTS) {
    test(`widget renders total count + breakdown — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await goToPipeline(page);

      // Init widget explicitly
      await page.evaluate(() => {
        if (window.lostReasonsWidget) window.lostReasonsWidget.init('lost-reasons-widget-container');
      });
      await page.waitForTimeout(600);

      const container = page.locator('#lost-reasons-widget-container');
      await expect(container).toBeVisible({ timeout: 4000 });

      const totalVal = container.locator('.lrw-total-val').first();
      await expect(totalVal).toHaveText('12', { timeout: 3000 });

      // At least one bar row should be present
      await expect(container.locator('.lrw-row')).toHaveCount(4);
      await page.screenshot({ path: `${OUT}/lost-reasons-widget-${vp.name}.png` });
    });

    test(`widget range buttons switch data range — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await goToPipeline(page);

      await page.evaluate(() => {
        if (window.lostReasonsWidget) window.lostReasonsWidget.init('lost-reasons-widget-container');
      });
      await page.waitForTimeout(600);

      const btn60 = page.locator('.lrw-range-btn[data-days="60"]');
      await expect(btn60).toBeVisible({ timeout: 3000 });
      await btn60.click();
      await page.waitForTimeout(300);
      await expect(btn60).toHaveClass(/lrw-range-active/);
      await page.screenshot({ path: `${OUT}/lost-reasons-widget-range-${vp.name}.png` });
    });
  }
});

// ── 6. Flag off — no pill, no widget ─────────────────────────────────────────
test.describe('Wave 1.5 — flag OFF — no regression', () => {
  test('no past-event pill when flag off', async ({ page }) => {
    await setupMocks(page);
    // Override flags — lost_reasons_v1 disabled
    await page.route('**/api/flags', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
        { name: 'nav_v2',             enabled: true,  description: '' },
        { name: 'kanban_restructure', enabled: true,  description: '' },
        { name: 'lost_reasons_v1',    enabled: false, description: '' },
      ]}) }));
    await goToPipeline(page);

    const pill = page.locator('.kb-tag-past-event');
    await expect(pill).toHaveCount(0);
  });

  test('lost-reasons widget container stays hidden when flag off', async ({ page }) => {
    await setupMocks(page);
    await page.route('**/api/flags', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
        { name: 'nav_v2',             enabled: true,  description: '' },
        { name: 'kanban_restructure', enabled: true,  description: '' },
        { name: 'lost_reasons_v1',    enabled: false, description: '' },
      ]}) }));
    await goToPipeline(page);

    await page.evaluate(() => {
      if (window.lostReasonsWidget) window.lostReasonsWidget.init('lost-reasons-widget-container');
    });
    await page.waitForTimeout(300);

    const container = page.locator('#lost-reasons-widget-container');
    // Should stay display:none when flag is off
    const display = await container.evaluate(el => el.style.display);
    expect(display).toBe('none');
  });
});
