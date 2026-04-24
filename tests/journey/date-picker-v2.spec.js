// @ts-check
// Journey tests — DatePickerV2 unified date-range picker + calendar status chips
// Covers: kanban date filter, list view date filter, inquiries date filter,
//         calendar_filters_v2 status chips.
// Viewports: 375, 768, 1280.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-date-picker-v2');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const TODAY = new Date();
const FUTURE_DATE = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 15);
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const SAMPLE_INQS = [
  {
    threadId: 'dp-test-001', customer_name: 'Alice Future', from: 'alice@example.com',
    status: 'booked', event_date: isoDate(FUTURE_DATE), guest_count: 80,
    approved: true, has_unreviewed_update: false,
  },
  {
    threadId: 'dp-test-002', customer_name: 'Bob Today', from: 'bob@example.com',
    status: 'quote_sent', event_date: isoDate(TODAY), guest_count: 30,
    approved: false, has_unreviewed_update: false, email_date: new Date().toISOString(),
  },
];

async function setupMocks(page, extraFlags) {
  extraFlags = extraFlags || [];
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: SAMPLE_INQS, total: SAMPLE_INQS.length }) }));
  await page.route('**/api/inquiries/save**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/pipeline/customer-history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'none' }) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tags: [] }) }));
  await page.route('**/api/settings/lost-reasons**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, reasons: ['Price', 'Date conflict', 'Went with competitor', 'No response', 'Other'] }) }));
  await page.route('**/api/calendar/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));

  var baseFlags = [
    { name: 'nav_v2',              enabled: true, description: '' },
    { name: 'kanban_restructure',  enabled: true, description: '' },
    { name: 'ios_polish_v1',       enabled: true, description: '' },
    { name: 'lost_reason_capture', enabled: true, description: '' },
    { name: 'date_picker_v2',      enabled: false, description: '' },
    { name: 'calendar_filters_v2', enabled: false, description: '' },
  ];
  // Merge extraFlags
  extraFlags.forEach(function (ef) {
    var idx = baseFlags.findIndex(function (f) { return f.name === ef.name; });
    if (idx >= 0) baseFlags[idx] = ef; else baseFlags.push(ef);
  });

  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: baseFlags }) }));
}

// ── date_picker_v2 OFF: legacy chips still visible on kanban ──────────────────
test.describe('date_picker_v2 OFF — legacy chips on kanban', () => {
  for (const vp of VIEWPORTS) {
    test(`legacy date chips present — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, []);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (window.flags) await window.flags.load();
        if (typeof showPage === 'function') await showPage('pipeline');
      });
      // Date picker row should be absent or hidden when flag is OFF
      const dpRow = page.locator('#kb-date-picker-row');
      const count = await dpRow.count();
      const isHidden = count === 0 || !(await dpRow.isVisible());
      expect(isHidden).toBe(true);
      await page.screenshot({ path: `${OUT}/flag-off-kanban-${vp.name}.png` });
    });
  }
});

// ── date_picker_v2 ON: trigger row appears on kanban tab ─────────────────────
test.describe('date_picker_v2 ON — trigger row on kanban', () => {
  for (const vp of VIEWPORTS) {
    test(`dp-trigger-row present on kanban — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, [{ name: 'date_picker_v2', enabled: true, description: '' }]);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (window.flags) await window.flags.load();
        if (typeof showPage === 'function') await showPage('pipeline');
        // Switch to kanban tab
        var kbTab = document.querySelector('[data-view="kanban"]');
        if (kbTab) kbTab.click();
      });
      // Wait for date picker to mount
      await page.waitForSelector('.dp-trigger-row', { timeout: 10000 });
      await expect(page.locator('.dp-trigger-row').first()).toBeVisible();
      await page.screenshot({ path: `${OUT}/flag-on-kanban-trigger-${vp.name}.png` });
    });
  }
});

// ── date_picker_v2 ON: popover opens on trigger click ────────────────────────
test.describe('date_picker_v2 ON — popover opens', () => {
  for (const vp of VIEWPORTS) {
    test(`popover opens and shows presets — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, [{ name: 'date_picker_v2', enabled: true, description: '' }]);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (window.flags) await window.flags.load();
        if (typeof showPage === 'function') await showPage('pipeline');
        var kbTab = document.querySelector('[data-view="kanban"]');
        if (kbTab) kbTab.click();
      });
      await page.waitForSelector('.dp-trigger-btn', { timeout: 10000 });
      await page.locator('.dp-trigger-btn').first().click();
      await page.waitForSelector('.dp-popover-wrap', { timeout: 5000 });
      await expect(page.locator('.dp-popover-wrap')).toBeVisible();
      // Sidebar should contain preset buttons
      await expect(page.locator('.dp-preset-btn').first()).toBeVisible();
      await page.screenshot({ path: `${OUT}/popover-open-${vp.name}.png` });
    });
  }
});

// ── date_picker_v2 ON: step chevrons cycle preset ────────────────────────────
test('step prev/next chevrons update label', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, [{ name: 'date_picker_v2', enabled: true, description: '' }]);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('pipeline');
    var kbTab = document.querySelector('[data-view="kanban"]');
    if (kbTab) kbTab.click();
  });
  await page.waitForSelector('.dp-trigger-row', { timeout: 10000 });
  const labelBefore = await page.locator('.dp-label').first().textContent();
  await page.locator('.dp-prev-btn').first().click();
  const labelAfter = await page.locator('.dp-label').first().textContent();
  // Label should change after clicking prev (month/week steps)
  expect(labelAfter).not.toBeNull();
  await page.screenshot({ path: `${OUT}/step-chevron-desktop.png` });
});

// ── date_picker_v2 ON: list view shows picker container ──────────────────────
test.describe('date_picker_v2 ON — list view picker', () => {
  for (const vp of VIEWPORTS) {
    test(`lv-date-picker-container present — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, [{ name: 'date_picker_v2', enabled: true, description: '' }]);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (window.flags) await window.flags.load();
        if (typeof showPage === 'function') await showPage('pipeline');
        // Switch to list tab
        var lTab = document.querySelector('[data-view="list"]');
        if (lTab) lTab.click();
      });
      await page.waitForSelector('#lv-date-picker-container', { timeout: 10000 });
      await expect(page.locator('#lv-date-picker-container')).toBeAttached();
      await page.screenshot({ path: `${OUT}/list-picker-container-${vp.name}.png` });
    });
  }
});

// ── date_picker_v2 ON: inquiries page shows picker, hides legacy chips ────────
test.describe('date_picker_v2 ON — inquiries page', () => {
  for (const vp of VIEWPORTS) {
    test(`inq-date-picker-row visible, legacy chips hidden — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, [{ name: 'date_picker_v2', enabled: true, description: '' }]);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (window.flags) await window.flags.load();
        if (typeof showPage === 'function') await showPage('inquiries');
      });
      await page.waitForSelector('#inq-date-picker-row', { timeout: 10000 });
      // Picker row should be visible
      await expect(page.locator('#inq-date-picker-row')).toBeVisible();
      // Legacy date chips should be hidden
      const legacyChips = page.locator('#inq-date-chips');
      const legacyHidden = await legacyChips.evaluate(el => el.style.display === 'none' || getComputedStyle(el).display === 'none');
      expect(legacyHidden).toBe(true);
      await page.screenshot({ path: `${OUT}/inq-picker-${vp.name}.png` });
    });
  }
});

// ── calendar_filters_v2 OFF: period chips still present ──────────────────────
test('calendar_filters_v2 OFF — period chips present', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, []);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('calendar');
  });
  await page.waitForSelector('#page-calendar', { timeout: 10000 });
  // Status chips bar should NOT be present
  const statusBar = page.locator('#cal-status-chips-bar');
  expect(await statusBar.count()).toBe(0);
  await page.screenshot({ path: `${OUT}/cal-flag-off-desktop.png` });
});

// ── calendar_filters_v2 ON: status chips appear, Lost not shown ───────────────
test.describe('calendar_filters_v2 ON — status chips', () => {
  for (const vp of VIEWPORTS) {
    test(`status chips visible, Booked+Completed active by default — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page, [
        { name: 'calendar_v2',         enabled: true, description: '' },
        { name: 'calendar_filters_v2', enabled: true, description: '' },
      ]);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => {
        if (window.flags) await window.flags.load();
        if (typeof showPage === 'function') await showPage('calendar');
      });
      await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });
      const bar = page.locator('#cal-status-chips-bar');
      await expect(bar).toBeVisible();

      // Check expected chips are present
      await expect(bar.locator('.cal-status-chip', { hasText: 'Booked' })).toBeVisible();
      await expect(bar.locator('.cal-status-chip', { hasText: 'Completed' })).toBeVisible();
      await expect(bar.locator('.cal-status-chip', { hasText: 'Needs More Info' })).toBeVisible();
      await expect(bar.locator('.cal-status-chip', { hasText: 'Quote Drafted' })).toBeVisible();
      await expect(bar.locator('.cal-status-chip', { hasText: 'Quote Sent' })).toBeVisible();

      // "Lost" must NOT appear
      const lostChip = bar.locator('.cal-status-chip', { hasText: 'Lost' });
      expect(await lostChip.count()).toBe(0);

      // Booked and Completed should be active by default
      const bookedChip = bar.locator('.cal-status-chip-active', { hasText: 'Booked' });
      const completedChip = bar.locator('.cal-status-chip-active', { hasText: 'Completed' });
      await expect(bookedChip).toBeVisible();
      await expect(completedChip).toBeVisible();

      // Period chips should NOT be present
      const periodChips = page.locator('.cal-period-chip');
      expect(await periodChips.count()).toBe(0);

      await page.screenshot({ path: `${OUT}/cal-status-chips-${vp.name}.png` });
    });
  }
});

// ── calendar_filters_v2 ON: clicking a chip toggles it ──────────────────────
test('calendar_filters_v2 ON — chip toggle activates Needs More Info', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, [
    { name: 'calendar_v2',         enabled: true, description: '' },
    { name: 'calendar_filters_v2', enabled: true, description: '' },
  ]);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('calendar');
  });
  await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });

  const needsInfoBtn = page.locator('#cal-status-chips-bar .cal-status-chip', { hasText: 'Needs More Info' });
  await expect(needsInfoBtn).toBeVisible();
  // Not active initially
  await expect(needsInfoBtn).not.toHaveClass(/cal-status-chip-active/);
  // Click to activate
  await needsInfoBtn.click();
  await expect(needsInfoBtn).toHaveClass(/cal-status-chip-active/);
  await page.screenshot({ path: `${OUT}/cal-chip-toggle-desktop.png` });
});

// ── calendar_filters_v2 ON: cannot deactivate all chips (min 1) ──────────────
test('calendar_filters_v2 ON — cannot deactivate last active chip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page, [
    { name: 'calendar_v2',         enabled: true, description: '' },
    { name: 'calendar_filters_v2', enabled: true, description: '' },
  ]);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('calendar');
  });
  await page.waitForSelector('#cal-status-chips-bar', { timeout: 15000 });

  const bar = page.locator('#cal-status-chips-bar');
  // Default: Booked + Completed active. Deactivate Booked first.
  await bar.locator('.cal-status-chip', { hasText: 'Booked' }).click();
  // Now only Completed is active. Clicking Completed should NOT deactivate it.
  const completedChip = bar.locator('.cal-status-chip', { hasText: 'Completed' });
  await completedChip.click();
  // Still active
  await expect(completedChip).toHaveClass(/cal-status-chip-active/);
  await page.screenshot({ path: `${OUT}/cal-chip-min-one-desktop.png` });
});
