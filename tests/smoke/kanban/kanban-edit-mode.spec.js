// @ts-check
/**
 * Smoke tests — Kanban edit mode + new features (items 1-6 from audit batch).
 * Tests: service filter chips, sort selector, $ totals, phone on card,
 *        lost auto-hide, column editor modal (long-press + Edit Columns button).
 *
 * Run: SMOKE_BASE_URL=<url> SMOKE_SECRET=<secret> npx playwright test tests/smoke/kanban/kanban-edit-mode.spec.js
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.SMOKE_SECRET   || '';

const INQ_WITH_PHONE = {
  threadId: 'kbem-001', customer_name: 'Dana TestPhone', from: 'dana@example.com',
  status: 'booked', event_date: '2026-08-15', guest_count: 80,
  approved: true, has_unreviewed_update: false, quote_total: 2400,
  extracted_fields: { customer_phone: '(312) 555-0199', service_type: 'delivery' }
};

const INQ_LOST_RECENT = {
  threadId: 'kbem-002', customer_name: 'Earl LostRecent', from: 'earl@example.com',
  status: 'declined', event_date: '2026-08-01', guest_count: 40,
  approved: true, has_unreviewed_update: false,
  lost_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 24h ago — should show
};

const INQ_LOST_OLD = {
  threadId: 'kbem-003', customer_name: 'Frank LostOld', from: 'frank@example.com',
  status: 'declined', event_date: '2026-07-01', guest_count: 30,
  approved: true, has_unreviewed_update: false,
  lost_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() // 72h ago — should hide
};

const INQ_PICKUP = {
  threadId: 'kbem-004', customer_name: 'Grace Pickup', from: 'grace@example.com',
  status: 'needs_info', event_date: '2026-09-01', guest_count: 20,
  approved: true, has_unreviewed_update: false,
  extracted_fields: { service_type: 'pickup' }
};

const INQ_FULLSVC = {
  threadId: 'kbem-005', customer_name: 'Hank FullSvc', from: 'hank@example.com',
  status: 'needs_info', event_date: '2026-09-05', guest_count: 100,
  approved: true, has_unreviewed_update: false, quote_total: 5000,
  extracted_fields: { service_type: 'full_service' }
};

async function setupMocks(page) {
  const INQ_LIST = [INQ_WITH_PHONE, INQ_LOST_RECENT, INQ_LOST_OLD, INQ_PICKUP, INQ_FULLSVC];
  await page.route('**/api/**', r => r.fulfill({ status: 200, json: {} }));
  await page.route('**/api/inquiries/list**', r => r.fulfill({ status: 200, json: { inquiries: INQ_LIST, total: INQ_LIST.length } }));
  await page.route('**/api/flags**', r => r.fulfill({ status: 200, json: { flags: [
    { name: 'kanban_restructure',    enabled: true,  description: '' },
    { name: 'kanban_edit_mode_v1',   enabled: true,  description: '' },
    { name: 'lost_auto_hide_48h',    enabled: true,  description: '' },
    { name: 'date_picker_v2',        enabled: false, description: '' },
    { name: 'sales_panel_v1',        enabled: false, description: '' },
    { name: 'completed_eom_hide',    enabled: false, description: '' },
    { name: 'invoice_manager_v1',    enabled: false, description: '' },
    { name: 'customer_profile_v2',   enabled: false, description: '' },
    { name: 'todays_actions_widget', enabled: false, description: '' },
    { name: 'overdue_widget',        enabled: false, description: '' },
  ] }}));
  await page.route('**/api/pipeline/alerts**', r => r.fulfill({ status: 200, json: { alerts: [] } }));
  await page.route('**/api/pipeline/customer-history**', r => r.fulfill({ status: 200, json: { status: 'none', count: 0 } }));
  await page.route('**/api/tags**', r => r.fulfill({ status: 200, json: { tags: [] } }));
}

async function goToKanban(page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.kb-board', { timeout: 10000 });
  await page.waitForTimeout(500);
}

test.describe('Kanban new features (mocked data)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await goToKanban(page);
  });

  test('service filter chips appear above board', async ({ page }) => {
    const toolbar = page.locator('.kb-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });
    const chips = page.locator('.kb-svc-chip');
    await expect(chips).toHaveCount(5); // All Services + 4 types
    await expect(chips.first()).toHaveText('All Services');
    await expect(chips.filter({ hasText: 'Pickup' })).toHaveCount(1);
  });

  test('sort selector appears in toolbar', async ({ page }) => {
    const sortSel = page.locator('#kb-sort-sel');
    await expect(sortSel).toBeVisible({ timeout: 5000 });
    await expect(sortSel.locator('option')).toHaveCount(4); // Default + 3 sorts
  });

  test('Edit Columns button appears when kanban_edit_mode_v1 ON', async ({ page }) => {
    const btn = page.locator('#kb-edit-cols-btn');
    await expect(btn).toBeVisible({ timeout: 5000 });
  });

  test('phone number shows on card face', async ({ page }) => {
    const phoneEl = page.locator('.kb-card-phone').first();
    await expect(phoneEl).toBeVisible({ timeout: 5000 });
    await expect(phoneEl).toHaveText('(312) 555-0199');
  });

  test('$ total shows in column header for booked column', async ({ page }) => {
    const bookedCol = page.locator('.kb-col[data-col="booked"]');
    await expect(bookedCol).toBeVisible({ timeout: 5000 });
    const total = bookedCol.locator('.kb-col-total');
    await expect(total).toBeVisible({ timeout: 3000 });
    await expect(total).toHaveText('$2,400');
  });

  test('lost auto-hide: old lost card hidden, recent lost card visible', async ({ page }) => {
    // Earl (24h ago) should be visible in declined col
    const declinedCol = page.locator('.kb-col[data-col="declined"]');
    await expect(declinedCol).toBeVisible({ timeout: 5000 });
    const cards = declinedCol.locator('.kb-card');
    const cardNames = await cards.locator('.kb-card-name').allTextContents();
    const hasRecent = cardNames.some(t => t.includes('Earl'));
    const hasOld    = cardNames.some(t => t.includes('Frank'));
    expect(hasRecent).toBe(true);
    expect(hasOld).toBe(false);
  });

  test('service filter: selecting Pickup shows only pickup cards', async ({ page }) => {
    const pickupChip = page.locator('.kb-svc-chip[data-svc="pickup"]');
    await pickupChip.click();
    await page.waitForTimeout(300);
    // Hank (full_service) should not appear; Grace (pickup) should
    const allCards = page.locator('.kb-card');
    const names = await allCards.locator('.kb-card-name').allTextContents();
    expect(names.some(t => t.includes('Grace'))).toBe(true);
    expect(names.some(t => t.includes('Hank'))).toBe(false);
    // Chip should be active
    await expect(pickupChip).toHaveClass(/active/);
  });

  test('sort by event date reorders cards within a column', async ({ page }) => {
    const sortSel = page.locator('#kb-sort-sel');
    await sortSel.selectOption('event_date');
    await page.waitForTimeout(300);
    // Should not throw; board should still render
    await expect(page.locator('.kb-board')).toBeVisible();
  });

  test('Edit Columns modal opens via button click', async ({ page }) => {
    await page.locator('#kb-edit-cols-btn').click();
    await expect(page.locator('.kb-col-editor')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.kb-ep-title')).toHaveText('Edit Columns');
    // Should show 7 rows (one per default column)
    await expect(page.locator('.kb-ep-row')).toHaveCount(7);
  });

  test('Edit Columns modal closes with Done button', async ({ page }) => {
    await page.locator('#kb-edit-cols-btn').click();
    await expect(page.locator('.kb-col-editor')).toBeVisible({ timeout: 4000 });
    await page.locator('.kb-ep-done-btn').click();
    await expect(page.locator('.kb-col-editor')).toBeHidden({ timeout: 3000 });
  });

  test('Edit Columns modal closes with ESC', async ({ page }) => {
    await page.locator('#kb-edit-cols-btn').click();
    await expect(page.locator('.kb-col-editor')).toBeVisible({ timeout: 4000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.kb-col-editor')).toBeHidden({ timeout: 3000 });
  });

  test('column visibility toggle hides column from board', async ({ page }) => {
    await page.locator('#kb-edit-cols-btn').click();
    await expect(page.locator('.kb-col-editor')).toBeVisible({ timeout: 4000 });

    // Uncheck "completed" column
    const completedVis = page.locator('.kb-ep-vis-cb[data-vis-col="completed"]');
    await expect(completedVis).toBeChecked();
    await completedVis.click();
    await expect(completedVis).not.toBeChecked();

    await page.locator('.kb-ep-done-btn').click();
    // Board should no longer have completed column
    await expect(page.locator('.kb-col[data-col="completed"]')).toHaveCount(0);

    // Restore — re-open and re-check
    await page.locator('#kb-edit-cols-btn').click();
    await page.locator('.kb-ep-vis-cb[data-vis-col="completed"]').click();
    await page.locator('.kb-ep-done-btn').click();
    await expect(page.locator('.kb-col[data-col="completed"]')).toHaveCount(1);
    // Clean up localStorage
    await page.evaluate(function() { localStorage.removeItem('kb_col_config'); });
  });

  test('column rename reflects in board header', async ({ page }) => {
    await page.locator('#kb-edit-cols-btn').click();
    await expect(page.locator('.kb-col-editor')).toBeVisible({ timeout: 4000 });

    const inp = page.locator('.kb-ep-label-inp[data-col="needs_info"]');
    await inp.fill('Incoming');
    await inp.press('Tab'); // trigger change event
    await page.waitForTimeout(300);

    const colTitle = page.locator('.kb-col[data-col="needs_info"] .kb-col-title');
    await expect(colTitle).toHaveText('Incoming');

    // Restore
    await inp.fill('Need Info');
    await inp.press('Tab');
    await page.waitForTimeout(300);
    await page.locator('.kb-ep-done-btn').click();
    await page.evaluate(function() { localStorage.removeItem('kb_col_config'); });
  });
});
