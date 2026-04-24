// @ts-check
// QA for PR #37 — Sales Panel + Invoice Manager stub
// Covers:
//   1. Pipeline tiles: sales panel renders with time-range toggle (sales_panel_v1 ON)
//   2. Pipeline tiles: legacy count tiles shown when sales_panel_v1 OFF
//   3. Navigation: pipeline → invoices → back (invoice_manager_v1 ON)
//   4. Accounting nav section shows/hides with invoice_manager_v1 flag
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../outputs/qa-pr37');
fs.mkdirSync(OUT, { recursive: true });

const FLAGS_BOTH_ON = [
  { name: 'sales_panel_v1',        enabled: true,  description: 'QA mock' },
  { name: 'invoice_manager_v1',    enabled: true,  description: 'QA mock' },
  { name: 'kanban_restructure',    enabled: false, description: '' },
  { name: 'nav_v2',                enabled: false, description: '' },
  { name: 'notifications_center',  enabled: false, description: '' },
  { name: 'test_customer_mode',    enabled: false, description: '' },
  { name: 'completed_orders_view', enabled: false, description: '' },
  { name: 'event_day_view',        enabled: false, description: '' },
  { name: 'calendar_v2',           enabled: false, description: '' },
  { name: 'ai_quote_updates',      enabled: false, description: '' },
];

const FLAGS_BOTH_OFF = FLAGS_BOTH_ON.map(f =>
  (f.name === 'sales_panel_v1' || f.name === 'invoice_manager_v1')
    ? { ...f, enabled: false } : f
);

const FLAGS_SALES_ON_INV_OFF = FLAGS_BOTH_ON.map(f =>
  f.name === 'invoice_manager_v1' ? { ...f, enabled: false } : f
);

async function setupMocks(page, flags, summaryData) {
  // Catch-all first (LIFO — specific routes registered after will win)
  await page.route('**/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/auth/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) })
  );
  await page.route('**/api/tasks', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }) })
  );
  await page.route('**/api/inquiries/list', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ inquiries: [], total: 0 }) })
  );
  await page.route('**/api/pipeline/alerts', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ alerts: [] }) })
  );
  await page.route('**/api/notifications/vapid-key', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ publicKey: '' }) })
  );
  if (summaryData !== undefined) {
    await page.route('**/api/invoices/summary**', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(summaryData) })
    );
  }
  // Flags last (wins)
  await page.route('**/api/flags', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, flags }) })
  );
}

async function activatePipeline(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pp = document.getElementById('page-pipeline');
    if (pp) pp.classList.add('active');
  });
  await page.waitForTimeout(200);
}

const viewports = [
  { name: 'mobile',   w: 375,  h: 812 },
  { name: 'tablet',   w: 768,  h: 1024 },
  { name: 'desktop',  w: 1280, h: 900 },
];

// ── 1. Sales panel renders when flag is ON ─────────────────────────────────
test.describe('PR #37 — Sales Panel (sales_panel_v1 ON)', () => {
  const mockSummary = {
    ok: true, pastDue: 0, unpaid: 1200, charged: 4500, paid: 3300,
    from: '2026-04-01', to: '2026-04-23', period: 'this_month', _empty: false,
  };

  for (const vp of viewports) {
    test(`${vp.name} — sales panel renders with time-range toggle`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await setupMocks(page, FLAGS_BOTH_ON, mockSummary);
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await activatePipeline(page);

      const state = await page.evaluate(() => ({
        salesPanelVisible:  (document.getElementById('pipeline-sales-panel') || {}).style?.display !== 'none',
        legacyHidden:       (document.getElementById('pipeline-stats-legacy') || {}).style?.display === 'none',
        rangeBtns:          document.querySelectorAll('.sales-range-btn').length,
        viewAllBtn:         !!document.getElementById('sales-view-all-btn'),
        statGrid:           !!document.getElementById('sales-stat-grid'),
        customRowExists:    !!document.getElementById('sales-custom-row'),
      }));

      expect(state.salesPanelVisible).toBe(true);
      expect(state.legacyHidden).toBe(true);
      expect(state.rangeBtns).toBe(5);  // This Month, YTD, Last Week, Last Month, Custom
      expect(state.viewAllBtn).toBe(true);
      expect(state.statGrid).toBe(true);
      expect(state.customRowExists).toBe(true);

      await page.screenshot({ path: path.join(OUT, `${vp.name}-sales-panel.png`), fullPage: false });
      console.log(`✓ ${vp.name}: sales panel visible, legacy tiles hidden`);
    });
  }

  test('desktop — time-range toggle changes active button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_SALES_ON_INV_OFF, mockSummary);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await activatePipeline(page);

    // Default active = 'this_month'
    const defaultActive = await page.evaluate(() => {
      var btns = document.querySelectorAll('.sales-range-btn');
      var active = Array.from(btns).find(b => b.classList.contains('active'));
      return active ? active.getAttribute('data-range') : null;
    });
    expect(defaultActive).toBe('this_month');

    // Click YTD
    await page.evaluate(() => { window.invoiceMgr && window.invoiceMgr._setRange('ytd'); });
    await page.waitForTimeout(100);

    const afterYtd = await page.evaluate(() => {
      var btns = document.querySelectorAll('.sales-range-btn');
      var active = Array.from(btns).find(b => b.classList.contains('active'));
      return active ? active.getAttribute('data-range') : null;
    });
    expect(afterYtd).toBe('ytd');

    // Click Custom — custom row should become visible
    await page.evaluate(() => { window.invoiceMgr && window.invoiceMgr._setRange('custom'); });
    await page.waitForTimeout(100);

    const customVisible = await page.evaluate(() => {
      var row = document.getElementById('sales-custom-row');
      return row && row.classList.contains('visible');
    });
    expect(customVisible).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-range-toggle.png'), fullPage: false });
    console.log('✓ desktop: range toggle works, custom row shows');
  });

  test('desktop — View All Invoices button navigates to #page-invoices', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_ON, mockSummary);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await activatePipeline(page);

    await page.evaluate(() => {
      var btn = document.getElementById('sales-view-all-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(200);

    const invoicesActive = await page.evaluate(() => {
      var pg = document.getElementById('page-invoices');
      return pg && pg.classList.contains('active');
    });
    expect(invoicesActive).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-invoices-page.png'), fullPage: false });
    console.log('✓ desktop: View All Invoices navigates to #page-invoices');
  });
});

// ── 2. Legacy tiles when flag is OFF ──────────────────────────────────────
test.describe('PR #37 — Legacy tiles (sales_panel_v1 OFF)', () => {
  test('desktop — legacy count tiles shown, sales panel hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_OFF, undefined);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await activatePipeline(page);

    const state = await page.evaluate(() => ({
      legacyVisible: (document.getElementById('pipeline-stats-legacy') || {}).style?.display !== 'none',
      salesHidden:   (document.getElementById('pipeline-sales-panel') || {}).style?.display === 'none',
      statActive:    !!document.getElementById('stat-active'),
      statQuoted:    !!document.getElementById('stat-quoted'),
    }));

    expect(state.legacyVisible).toBe(true);
    expect(state.salesHidden).toBe(true);
    expect(state.statActive).toBe(true);
    expect(state.statQuoted).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-legacy-tiles-off.png'), fullPage: false });
    console.log('✓ desktop: legacy tiles visible, sales panel hidden when flag OFF');
  });
});

// ── 3. Navigation: pipeline → invoices → back ─────────────────────────────
test.describe('PR #37 — Invoice Manager navigation', () => {
  test('desktop — pipeline → invoices → pipeline (invoice_manager_v1 ON)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_ON, { ok: true, pastDue: 0, unpaid: 0, charged: 0, paid: 0, _empty: true });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Start on pipeline
    const pipelineActive = await page.evaluate(() =>
      document.getElementById('page-pipeline')?.classList.contains('active')
    );
    expect(pipelineActive).toBe(true);

    // Navigate to invoices
    await page.evaluate(() => { window.showPage && window.showPage('invoices'); });
    await page.waitForTimeout(200);

    const invoicesActive = await page.evaluate(() =>
      document.getElementById('page-invoices')?.classList.contains('active')
    );
    expect(invoicesActive).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-nav-invoices.png'), fullPage: false });

    // Back to pipeline via the ← Pipeline button
    await page.evaluate(() => { window.showPage && window.showPage('pipeline'); });
    await page.waitForTimeout(200);

    const backToPipeline = await page.evaluate(() =>
      document.getElementById('page-pipeline')?.classList.contains('active')
    );
    expect(backToPipeline).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-nav-back.png'), fullPage: false });
    console.log('✓ desktop: pipeline → invoices → pipeline navigation works');
  });

  test('desktop — invoices page has coming-soon stub content', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_ON, undefined);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { window.showPage && window.showPage('invoices'); });
    await page.waitForTimeout(200);

    const hasStub = await page.evaluate(() => !!document.querySelector('#page-invoices .coming-soon'));
    expect(hasStub).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-invoices-stub.png'), fullPage: false });
    console.log('✓ desktop: invoices page shows coming-soon stub');
  });
});

// ── 4. Accounting nav section ─────────────────────────────────────────────
test.describe('PR #37 — Accounting nav section', () => {
  test('desktop — Accounting label and active Invoices link visible when flag ON', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_ON, undefined);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const state = await page.evaluate(() => ({
      labelVisible:   (document.getElementById('nav-accounting-label') || {}).style?.display !== 'none',
      activeVisible:  (document.getElementById('nav-invoices-active')  || {}).style?.display !== 'none',
      stubHidden:     (document.getElementById('nav-invoices-stub')    || {}).style?.display === 'none',
    }));

    expect(state.labelVisible).toBe(true);
    expect(state.activeVisible).toBe(true);
    expect(state.stubHidden).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-accounting-nav-on.png'), fullPage: false });
    console.log('✓ desktop: Accounting nav visible when invoice_manager_v1 ON');
  });

  test('desktop — Accounting label hidden and stub shown when flag OFF', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_OFF, undefined);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const state = await page.evaluate(() => ({
      labelHidden:  (document.getElementById('nav-accounting-label') || {}).style?.display === 'none',
      activeHidden: (document.getElementById('nav-invoices-active')  || {}).style?.display === 'none',
      stubVisible:  (document.getElementById('nav-invoices-stub')    || {}).style?.display !== 'none',
    }));

    expect(state.labelHidden).toBe(true);
    expect(state.activeHidden).toBe(true);
    expect(state.stubVisible).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-accounting-nav-off.png'), fullPage: false });
    console.log('✓ desktop: Accounting nav hidden when invoice_manager_v1 OFF');
  });

  test('desktop — clicking active Invoices nav item navigates to page-invoices', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page, FLAGS_BOTH_ON, undefined);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page.evaluate(() => {
      var navItem = document.getElementById('nav-invoices-active');
      if (navItem) navItem.click();
    });
    await page.waitForTimeout(200);

    const invoicesActive = await page.evaluate(() =>
      document.getElementById('page-invoices')?.classList.contains('active')
    );
    expect(invoicesActive).toBe(true);

    await page.screenshot({ path: path.join(OUT, 'desktop-nav-invoices-click.png'), fullPage: false });
    console.log('✓ desktop: nav Invoices item click lands on #page-invoices');
  });
});
