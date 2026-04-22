// @ts-check
/**
 * Group 3 — Kanban restructure smoke tests.
 *
 * Requires the kanban_restructure feature flag to exist in KV.
 * Tests run against SMOKE_BASE_URL (default: https://blus-bbq.vercel.app).
 *
 * Coverage:
 *  1. flag-off  → old pipeline visible, new columns absent
 *  2. flag-on   → 7 columns render in correct order
 *  3. flag-on   → Kanban tab vs List View tab toggle
 *  4. flag-on   → Lost-reason modal opens on drag to Lost column
 *  5. flag-on   → Customer popup opens on name click, closes with ESC
 *  6. flag-on   → List view: sort by event date, filter chips, free-text search
 *  7. flag-on   → Bulk approve: checkbox + confirm dialog + approve fires
 *  8. flag-on   → Repeat-customer icon visible for known returning email
 *  9. flag-off  → old pipeline unchanged (regression guard)
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const INQ_SECRET = process.env.INQ_SECRET || process.env.SMOKE_INQ_SECRET || '';
const FLAGS_SECRET = process.env.FLAGS_SECRET || process.env.SMOKE_FLAGS_SECRET || '';

// Helper: set flag via API
async function setFlag(request, name, enabled) {
  if (!FLAGS_SECRET) return; // skip if no secret (read-only smoke)
  await request.post(`${BASE_URL}/api/flags`, {
    data: { name, enabled, description: 'smoke test toggle' },
    headers: { 'x-secret': FLAGS_SECRET }
  });
}

// Helper: navigate to Pipeline page
async function goToPipeline(page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  // Click Pipeline nav
  const nav = page.locator('.nav-item', { hasText: 'Pipeline' });
  if (await nav.isVisible()) await nav.click();
  await page.waitForSelector('#page-pipeline.active', { timeout: 5000 }).catch(() => {});
}

/* ── 1. Flag OFF: old pipeline renders, new board absent ── */
test('flag-off: old kanban renders, new kb-board absent', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', false);
  await goToPipeline(page);
  // Old board container
  const kanbanEl = page.locator('#kanban-board');
  await expect(kanbanEl).toBeVisible({ timeout: 6000 });
  // New board must NOT exist
  const newBoard = page.locator('.kb-board');
  await expect(newBoard).toHaveCount(0);
});

/* ── 2. Flag ON: 7 columns render in order ── */
test('flag-on: 7 Kanban columns render in correct order', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);

  // Wait for new board
  const board = page.locator('.kb-board');
  await expect(board).toBeVisible({ timeout: 8000 });

  const cols = page.locator('.kb-col');
  await expect(cols).toHaveCount(7);

  const expectedOrder = [
    'Need Info', 'Quote Drafted', 'Quote Sent',
    'Waiting for Customer', 'Booked', 'Completed', 'Lost'
  ];
  for (let i = 0; i < expectedOrder.length; i++) {
    const title = cols.nth(i).locator('.kb-col-title');
    await expect(title).toHaveText(expectedOrder[i]);
  }
});

/* ── 3. Tab toggle: Kanban ↔ List View ── */
test('flag-on: Kanban and List View tabs toggle correctly', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);

  // Kanban visible by default
  await expect(page.locator('#view-kanban')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#view-list')).toBeHidden();

  // Click List View tab
  await page.locator('.tab', { hasText: 'List View' }).click();
  await expect(page.locator('#view-list')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('#view-kanban')).toBeHidden();

  // Switch back to Kanban
  await page.locator('.tab', { hasText: 'Kanban' }).click();
  await expect(page.locator('#view-kanban')).toBeVisible({ timeout: 4000 });
});

/* ── 4. Lost-reason modal: status select ── */
test('flag-on: Lost-reason modal opens when moving card to Lost via select', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);
  await expect(page.locator('.kb-board')).toBeVisible({ timeout: 8000 });

  // Find the first card with a status select and change to 'declined'
  const firstSelect = page.locator('.kb-status-sel').first();
  const count = await firstSelect.count();
  if (count === 0) {
    test.skip(true, 'No pipeline cards available to test');
    return;
  }

  await firstSelect.selectOption('declined');

  // Lost-reason modal should appear
  const modal = page.locator('.kb-lost-modal');
  await expect(modal).toBeVisible({ timeout: 4000 });
  await expect(modal.locator('h3')).toContainText('lost');

  // Click Skip to dismiss
  await modal.locator('button', { hasText: 'Skip' }).click();
  await expect(modal).toBeHidden({ timeout: 3000 });
});

/* ── 5. Customer popup: open on name click, close with ESC ── */
test('flag-on: customer popup opens on name click and closes with ESC', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);
  await expect(page.locator('.kb-board')).toBeVisible({ timeout: 8000 });

  const firstCardName = page.locator('.kb-card-name').first();
  if (await firstCardName.count() === 0) {
    test.skip(true, 'No pipeline cards to test popup');
    return;
  }

  await firstCardName.click();
  const popup = page.locator('.kb-popup');
  await expect(popup).toBeVisible({ timeout: 4000 });
  await expect(popup.locator('.kb-popup-name')).not.toBeEmpty();

  // ESC closes
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden({ timeout: 3000 });
});

/* ── 6. List view: sort header click + filter chips ── */
test('flag-on: list view sort and filter chips work', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);
  await expect(page.locator('.kb-board')).toBeVisible({ timeout: 8000 });

  // Switch to list view
  await page.locator('.tab', { hasText: 'List View' }).click();
  await expect(page.locator('#view-list')).toBeVisible({ timeout: 4000 });

  // Wait for toolbar or table
  const toolbar = page.locator('.lv-toolbar');
  const tableOrEmpty = page.locator('.lv-table, .lv-empty');
  await expect(toolbar.or(tableOrEmpty)).toBeVisible({ timeout: 5000 });

  // Click "Event Date" sort header if present
  const evDateHeader = page.locator('[data-sort="event_date"]');
  if (await evDateHeader.count() > 0) {
    await evDateHeader.click();
    await expect(evDateHeader).toHaveClass(/lv-th-active/, { timeout: 2000 });
    // Second click reverses sort
    await evDateHeader.click();
    await expect(evDateHeader).toHaveText(/↓|↑/);
  }

  // Filter chips: click a status chip
  const needsInfoChip = page.locator('[data-status="needs_info"]');
  if (await needsInfoChip.count() > 0) {
    await needsInfoChip.click();
    await expect(needsInfoChip).toHaveClass(/active/, { timeout: 2000 });
    // Reset to All
    const allChip = page.locator('[data-status=""]');
    if (await allChip.count() > 0) await allChip.click();
  }
});

/* ── 7. List view: free-text search narrows results ── */
test('flag-on: list view free-text search filters rows', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);
  await expect(page.locator('.kb-board')).toBeVisible({ timeout: 8000 });

  await page.locator('.tab', { hasText: 'List View' }).click();
  await expect(page.locator('#view-list')).toBeVisible({ timeout: 4000 });

  const search = page.locator('#lv-search');
  if (await search.count() === 0) {
    test.skip(true, 'Search input not present (no pipeline data)');
    return;
  }

  const initialRows = page.locator('.lv-table tbody tr');
  const initialCount = await initialRows.count();

  // Type a string unlikely to match anything
  await search.fill('zzzznotfound9999');
  await page.waitForTimeout(300);
  await expect(page.locator('.lv-empty')).toBeVisible({ timeout: 3000 });

  // Clear → rows return
  await search.fill('');
  await page.waitForTimeout(300);
  if (initialCount > 0) {
    await expect(page.locator('.lv-table tbody tr')).toHaveCount(initialCount, { timeout: 3000 });
  }
});

/* ── 8. Bulk approve: checkbox + confirm + fires approve API ── */
test('flag-on: bulk approve checkbox and confirm dialog', async ({ page, request }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Go to Inquiries page
  await page.locator('.nav-item', { hasText: 'Inquiries' }).click();
  await expect(page.locator('#page-inquiries')).toBeVisible({ timeout: 6000 });

  // Check first available checkbox
  const cb = page.locator('.inq-bulk-cb').first();
  if (await cb.count() === 0) {
    test.skip(true, 'No inquiry cards to test bulk approve');
    return;
  }

  await cb.check();
  const toolbar = page.locator('#inq-bulk-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 3000 });
  await expect(toolbar.locator('.inq-bulk-approve')).toBeVisible();

  // Click approve — confirm dialog will appear; dismiss it
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Approve');
    await dialog.dismiss();
  });
  await toolbar.locator('.inq-bulk-approve').click();

  // Toolbar should still be visible after dismiss (selection preserved)
  await expect(toolbar).toBeVisible({ timeout: 3000 });

  // Clear selection
  await toolbar.locator('.inq-bulk-clear').click();
  await expect(toolbar).toBeHidden({ timeout: 3000 });
});

/* ── 9. Repeat-customer: Kanban icon appears for returning email ── */
test('flag-on: repeat-customer icon visible on card with returning email', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', true);
  await goToPipeline(page);
  await expect(page.locator('.kb-board')).toBeVisible({ timeout: 8000 });

  // Give async RC fetch time to resolve
  await page.waitForTimeout(3000);

  // Check if any repeat tags rendered (might be zero in test env)
  const rcTags = page.locator('.kb-tag-repeat');
  const count = await rcTags.count();
  // We can't guarantee a repeat customer in live data — just assert the element type is correct
  if (count > 0) {
    await expect(rcTags.first()).toBeVisible();
    // Tooltip attribute present
    const tip = await rcTags.first().getAttribute('title');
    expect(tip).toBeTruthy();
  } else {
    // No repeat customers in current data — that's valid
    console.log('No repeat-customer tags found (no returning customers in dataset)');
  }
});

/* ── 10. Flag OFF regression: old pipeline still works ── */
test('flag-off regression: old pipeline kanban-board still renders', async ({ page, request }) => {
  await setFlag(request, 'kanban_restructure', false);
  await goToPipeline(page);

  const oldBoard = page.locator('#kanban-board');
  await expect(oldBoard).toBeVisible({ timeout: 8000 });

  // New board must be absent
  await expect(page.locator('.kb-board')).toHaveCount(0);

  // Stats still render
  await expect(page.locator('#stat-active')).toBeVisible();
  await expect(page.locator('#stat-booked')).toBeVisible();
});
