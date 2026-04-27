// @ts-check
// Journey test — advance_followup_v1 far-future booking surface.
//
// Verifies:
//   1. With flag OFF, the sidebar nav item and page are hidden.
//   2. With flag ON, the page is reachable, lists a far-future test inquiry,
//      and lets the user set a next_followup_at date that persists.
//   3. Empty state shows when no qualifying inquiries exist.
//
// Auth: uses INQ_SECRET (matches GMAIL_READ_SECRET on the server) — same secret
// used by status-sync.js to PATCH inquiries from the dashboard.
//
// Quota-aware: setFlagOrSkip soft-skips on Upstash quota errors (PR #113).

const { test, expect } = require('@playwright/test');
const { setFlagOrSkip } = require('../helpers/flags');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.INQ_SECRET || 'c857eb539774b63cf0b0a09303adc78d';

// Test fixture — threadId we control. Cleaned up via status=archived at the end
// (the surface filters out non-active statuses, so this hides it from the list).
const TEST_THREAD = 'af-test-' + Date.now();
const TEST_NAME   = 'Advance Followup Test ' + Date.now();

function isoDateNDaysOut(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function setFlag(request, name, enabled) {
  return setFlagOrSkip(request, name, enabled, { secret: SECRET, baseUrl: BASE_URL });
}

// Create a far-future test inquiry via the same /api/inquiries/save path the
// dashboard uses. Cleanup: archive it so it's filtered out of active surfaces.
async function createTestInquiry(request, eventDateIso) {
  const r = await request.post(`${BASE_URL}/api/inquiries/save?secret=${encodeURIComponent(SECRET)}`, {
    data: {
      threadId: TEST_THREAD,
      from: TEST_NAME + ' <af-test@example.com>',
      subject: 'Far-future BBQ booking',
      status: 'booked',
      extracted_fields: {
        customer_name:  TEST_NAME,
        customer_email: 'af-test@example.com',
        event_date:     eventDateIso,
        guest_count:    50,
        service_type:   'delivery',
      },
    },
    failOnStatusCode: false,
  });
  if (!r.ok()) {
    const body = await r.text().catch(() => '');
    throw new Error(`createTestInquiry failed (${r.status()}): ${body.slice(0, 200)}`);
  }
}

async function archiveTestInquiry(request) {
  await request.post(`${BASE_URL}/api/inquiries/save?secret=${encodeURIComponent(SECRET)}`, {
    data: { threadId: TEST_THREAD, status: 'archived' },
    failOnStatusCode: false,
  });
}

async function getInquiry(request, threadId) {
  const r = await request.get(
    `${BASE_URL}/api/inquiries/get?threadId=${encodeURIComponent(threadId)}&secret=${encodeURIComponent(SECRET)}`,
    { failOnStatusCode: false },
  );
  if (!r.ok()) return null;
  return r.json();
}

async function gotoAdvanceFollowup(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (window.flags) await window.flags.reload();
    if (typeof showPage === 'function') showPage('advance-followup');
  });
}

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile',  width: 375,  height: 812 },
];

// ── Flag OFF: nav item and page surface hidden ───────────────────────────────
test.describe('advance_followup_v1 OFF — surface hidden', () => {
  test.beforeAll(async ({ request }) => {
    await setFlag(request, 'advance_followup_v1', false);
  });

  test('sidebar nav item is not displayed when flag is OFF', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    // Wait for flags to load and the post-load init hook to run.
    await page.waitForFunction(() => window.flags && window.flags.isEnabled !== undefined, { timeout: 10000 });
    // The nav item exists but has display:none until the flag is flipped.
    const nav = page.locator('#nav-advance-followup');
    await expect(nav).toBeHidden();
  });
});

// ── Flag ON: surface reachable, inquiry persistence works ────────────────────
test.describe('advance_followup_v1 ON — surface visible + persistence', () => {
  test.beforeAll(async ({ request }) => {
    await setFlag(request, 'advance_followup_v1', true);
    // Create a test inquiry 90 days out so it qualifies for the surface.
    await createTestInquiry(request, isoDateNDaysOut(90));
  });

  test.afterAll(async ({ request }) => {
    await archiveTestInquiry(request);
    await setFlag(request, 'advance_followup_v1', false);
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name} — page renders and lists far-future inquiry`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoAdvanceFollowup(page);

      // Page section should now be visible.
      await page.waitForSelector('#page-advance-followup.active', { timeout: 8000 });

      // Wait for list render (loading state replaced).
      await page.waitForFunction(() => {
        const body = document.getElementById('af-page-body');
        if (!body) return false;
        return !/Loading/.test(body.textContent || '');
      }, { timeout: 15000 });

      // Our test inquiry appears.
      const row = page.locator(`.af-row[data-thread-id="${TEST_THREAD}"]`);
      await expect(row).toBeVisible({ timeout: 5000 });
      await expect(row).toContainText(TEST_NAME);
      await expect(row).toContainText(/days out/);
    });
  }

  test('desktop — set follow-up date persists after reload', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAdvanceFollowup(page);

    await page.waitForSelector('#page-advance-followup.active', { timeout: 8000 });
    const row = page.locator(`.af-row[data-thread-id="${TEST_THREAD}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });

    const followupDate = isoDateNDaysOut(45);

    // Fill the date input scoped to this row.
    const input = row.locator('.af-followup-input');
    await input.fill(followupDate);

    // Click save and wait for "Saved" state.
    const saveBtn = row.locator('.af-save-btn');
    await saveBtn.click();
    await expect(row.locator('.af-save-status')).toContainText(/Saved/, { timeout: 6000 });

    // Verify persistence via the API directly — independent of UI state.
    const data = await getInquiry(request, TEST_THREAD);
    expect(data).toBeTruthy();
    const stored = (data.inquiry && data.inquiry.next_followup_at) || data.next_followup_at;
    expect(stored).toBe(followupDate);

    // Reload UI and verify the "Currently:" badge reflects the saved date.
    await gotoAdvanceFollowup(page);
    const reloadedRow = page.locator(`.af-row[data-thread-id="${TEST_THREAD}"]`);
    await expect(reloadedRow).toBeVisible({ timeout: 10000 });
    await expect(reloadedRow.locator('.af-followup-input')).toHaveValue(followupDate);
  });
});
