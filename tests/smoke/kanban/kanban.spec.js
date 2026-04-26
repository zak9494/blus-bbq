// @ts-check
/**
 * Group 3 — Kanban restructure smoke tests.
 *
 * Flag-off tests always run (no auth needed).
 * Flag-on tests require SMOKE_SECRET (SELF_MODIFY_SECRET) to toggle the flag.
 * Matches the pattern established by tests/smoke/notifications/notifications.spec.js.
 *
 * Run:  SMOKE_BASE_URL=<preview> SMOKE_SECRET=<secret> npx playwright test tests/smoke/kanban/
 */
const { test, expect } = require('@playwright/test');
const { setFlagOrSkip } = require('../../helpers/flags');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.SMOKE_SECRET   || '';

async function setFlag(request, enabled) {
  return setFlagOrSkip(request, 'kanban_restructure', enabled, { secret: SECRET, baseUrl: BASE_URL });
}

async function goToPipeline(page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  const nav = page.locator('.nav-item', { hasText: 'Pipeline' });
  if (await nav.count() > 0 && !(await page.locator('#page-pipeline.active').count())) {
    await nav.first().click();
  }
  await page.waitForSelector('#page-pipeline', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/* ═══════════════════════════════════════════════════════════
   FLAG-OFF tests — always run, no auth needed
   ════════════════════════════════════════════════════════════ */

test('flag-off: old kanban-board renders, .kb-board absent', async ({ page, request }) => {
  if (SECRET) await setFlag(request, false);
  await goToPipeline(page);
  await expect(page.locator('#kanban-board')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.kb-board')).toHaveCount(0);
});

test('flag-off regression: stats still render', async ({ page, request }) => {
  if (SECRET) await setFlag(request, false);
  await goToPipeline(page);
  // Either legacy stat tiles (sales_panel_v1 OFF) or sales panel (sales_panel_v1 ON) must be visible
  const legacyVisible = await page.locator('#stat-active').isVisible().catch(() => false);
  const salesVisible  = await page.locator('#pipeline-sales-panel').isVisible().catch(() => false);
  expect(legacyVisible || salesVisible).toBeTruthy();
});

/* ═══════════════════════════════════════════════════════════
   FLAG-ON tests — require SMOKE_SECRET
   ════════════════════════════════════════════════════════════ */

test.describe('flag-on tests', () => {
  test.skip(!SECRET, 'Skipped: SMOKE_SECRET not set — flag cannot be toggled');

  test.beforeAll(async ({ request }) => {
    const r = await setFlag(request, true);
    expect(r.status()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    // Always restore to off — live site flag stays off
    await setFlag(request, false);
  });

  test('7 Kanban columns render in correct order', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('.kb-board')).toBeVisible({ timeout: 10000 });
    const cols = page.locator('.kb-col');
    await expect(cols).toHaveCount(7);
    const order = ['Need Info','Quote Drafted','Quote Sent','Waiting for Customer','Booked','Completed','Lost'];
    for (let i = 0; i < order.length; i++) {
      await expect(cols.nth(i).locator('.kb-col-title')).toHaveText(order[i], { timeout: 4000 });
    }
  });

  test('Kanban and List View tabs toggle correctly', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('#view-kanban')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#view-list')).toBeHidden();
    await page.locator('.tab', { hasText: 'List View' }).click();
    await expect(page.locator('#view-list')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#view-kanban')).toBeHidden();
    await page.locator('.tab', { hasText: 'Kanban' }).click();
    await expect(page.locator('#view-kanban')).toBeVisible({ timeout: 4000 });
  });

  test('Lost-reason modal opens when moving card to Lost via select', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('.kb-board')).toBeVisible({ timeout: 10000 });
    const selects = page.locator('.kb-status-sel');
    if (await selects.count() === 0) { test.skip(true, 'No pipeline cards'); return; }
    let target = null;
    for (let i = 0; i < await selects.count(); i++) {
      if (await selects.nth(i).inputValue() !== 'declined') { target = selects.nth(i); break; }
    }
    if (!target) { test.skip(true, 'All cards already in Lost status'); return; }
    await target.selectOption('declined');
    await expect(page.locator('.kb-lost-modal')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.kb-lost-modal h3')).toContainText('lost', { ignoreCase: true });
    await page.locator('.kb-lost-modal button', { hasText: 'Skip' }).click();
    await expect(page.locator('.kb-lost-modal')).toBeHidden({ timeout: 3000 });
  });

  test('customer popup opens on name click and closes with ESC', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('.kb-board')).toBeVisible({ timeout: 10000 });
    const names = page.locator('.kb-card-name');
    if (await names.count() === 0) { test.skip(true, 'No cards to test popup'); return; }
    await names.first().click();
    await expect(page.locator('.kb-popup')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.kb-popup-name')).not.toBeEmpty();
    await page.keyboard.press('Escape');
    await expect(page.locator('.kb-popup')).toBeHidden({ timeout: 3000 });
  });

  test('list view: sort headers and filter chips work', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('.kb-board')).toBeVisible({ timeout: 10000 });
    await page.locator('.tab', { hasText: 'List View' }).click();
    await expect(page.locator('#view-list')).toBeVisible({ timeout: 4000 });
    await page.waitForTimeout(1000);
    const toolbar = page.locator('.lv-toolbar');
    if (await toolbar.count() === 0) return; // empty pipeline is valid
    await expect(toolbar).toBeVisible({ timeout: 4000 });
    const evHdr = page.locator('[data-sort="event_date"]');
    if (await evHdr.count() > 0) {
      await evHdr.click();
      await expect(evHdr).toHaveClass(/lv-th-active/, { timeout: 2000 });
      await evHdr.click();
      await expect(evHdr).toHaveText(/↑|↓/);
    }
    const chips = page.locator('[data-status]');
    if (await chips.count() > 1) {
      await chips.nth(1).click();
      await expect(chips.nth(1)).toHaveClass(/active/, { timeout: 2000 });
      const allChip = chips.filter({ hasText: /^All/ }).first();
      if (await allChip.count() > 0) await allChip.click();
    }
  });

  test('list view: free-text search filters and clears', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('.kb-board')).toBeVisible({ timeout: 10000 });
    await page.locator('.tab', { hasText: 'List View' }).click();
    await expect(page.locator('#view-list')).toBeVisible({ timeout: 4000 });
    await page.waitForTimeout(1000);
    const search = page.locator('#lv-search');
    if (await search.count() === 0) { test.skip(true, 'No search field (empty pipeline)'); return; }
    const rows = page.locator('.lv-table tbody tr');
    const initial = await rows.count();
    await search.fill('zzzznotfound9999__unique');
    await page.waitForTimeout(400);
    await expect(page.locator('.lv-empty')).toBeVisible({ timeout: 3000 });
    await search.fill('');
    await page.waitForTimeout(400);
    if (initial > 0) await expect(rows).toHaveCount(initial, { timeout: 3000 });
  });

  test('repeat-customer icon appears for returning emails (graceful if none)', async ({ page }) => {
    await goToPipeline(page);
    await expect(page.locator('.kb-board')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(4000);
    const tags = page.locator('.kb-tag-repeat');
    const n = await tags.count();
    if (n > 0) {
      await expect(tags.first()).toBeVisible();
      const tip = await tags.first().getAttribute('title');
      expect(tip).toBeTruthy();
      console.log(`RC tags: ${n}, first tip: "${tip}"`);
    } else {
      console.log('No RC tags — no returning customers in dataset (valid)');
    }
  });
});

/* ═══════════════════════════════════════════════════════════
   BULK APPROVE — Inquiries page (flag-independent)
   ════════════════════════════════════════════════════════════ */

test('bulk approve: checkbox reveals button, dismiss preserves selection', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') showPage('inquiries');
  });
  await expect(page.locator('#page-inquiries')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#page-inquiries')).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(1500);
  const cb = page.locator('.inq-bulk-cb').first();
  if (await cb.count() === 0) { test.skip(true, 'No inquiry cards'); return; }
  await cb.check();
  await expect(page.locator('#inq-bulk-toolbar')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.inq-bulk-approve')).toBeVisible();
  page.once('dialog', async (d) => { expect(d.message()).toMatch(/Approve/i); await d.dismiss(); });
  await page.locator('.inq-bulk-approve').click();
  await expect(page.locator('#inq-bulk-toolbar')).toBeVisible({ timeout: 2000 });
  await page.locator('.inq-bulk-clear').click();
  await expect(page.locator('#inq-bulk-toolbar')).toBeHidden({ timeout: 3000 });
});
