// @ts-check
// Journey tests — AI Approval Actions (ai_approval_actions_v1)
// Scenarios:
//   1. Flag OFF  → Regenerate + Add Details buttons not rendered
//   2. Flag ON   → both buttons visible on approval card
//   3. Regenerate with feedback → draft body updated in place
//   4. Add Details with input  → draft body updated in place
// All endpoint responses are mocked.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const MOCK_ITEM = {
  id: 'ap-test-001',
  to: 'customer@example.com',
  name: 'Test Customer',
  subject: 'Catering Quote',
  body: 'Hi, here is your quote for the event.',
  inquiryId: 'thread-abc123',
  draftType: 'email',
  createdAt: new Date().toISOString(),
};

async function setupBaseMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));

  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, unread_count: 0 }) }));

  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));

  await page.route('**/api/pipeline/alerts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, alerts: [] }) }));

  await page.route('**/api/pipeline/overdue*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [] }) }));

  await page.route('**/api/events/today*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, events: [] }) }));

  await page.route('**/api/customers/tags*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, tags: [] }) }));

  // Approval queue — return one pending item
  await page.route('**/api/chat/approval*', r => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: [MOCK_ITEM] }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true }) });
  });
}

async function setupFlagsMock(page, actionsEnabled) {
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',                    enabled: true,           description: '' },
      { name: 'ios_polish_v1',             enabled: true,           description: '' },
      { name: 'lost_reason_capture',       enabled: false,          description: '' },
      { name: 'ai_approval_actions_v1',    enabled: actionsEnabled, description: '' },
    ]}) }));
}

async function loadAppAndOpenAI(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  // Navigate to AI chat page and trigger chatApprovalInit
  await page.evaluate(() => {
    if (window.showPage) window.showPage('ai');
    if (window.chatApprovalInit) window.chatApprovalInit();
  });
  await page.waitForTimeout(600);
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 1 — Flag OFF: buttons must not render
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 1. Flag OFF — Regenerate + Add Details not rendered`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, false);
    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-test-001"]');
    await expect(card).toBeAttached({ timeout: 4000 });

    // Neither refine button should exist
    await expect(card.locator('.approval-regen')).toHaveCount(0);
    await expect(card.locator('.approval-add-details')).toHaveCount(0);
    await expect(card.locator('.approval-refine-toolbar')).toHaveCount(0);
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 2 — Flag ON: both buttons visible
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 2. Flag ON — Regenerate + Add Details visible`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);
    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-test-001"]');
    await expect(card).toBeAttached({ timeout: 4000 });

    await expect(card.locator('.approval-regen')).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.approval-add-details')).toBeVisible({ timeout: 3000 });
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 3 — Regenerate with feedback updates draft text
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 3. Regenerate with feedback updates draft body`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);

    const UPDATED_BODY = 'Hi! Here is your concise catering quote.';
    let regenRequestBody = null;

    await page.route('**/api/ai/regenerate', async r => {
      regenRequestBody = await r.request().postDataJSON().catch(() => null);
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, body: UPDATED_BODY, draftType: 'email' }) });
    });

    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-test-001"]');
    await expect(card.locator('.approval-regen')).toBeVisible({ timeout: 4000 });

    // Click Regenerate — input row opens
    await card.locator('.approval-regen').click();
    const regenRow = card.locator('.approval-regen-row');
    await expect(regenRow).toBeVisible({ timeout: 2000 });

    // Type feedback
    const feedback = 'more concise';
    await regenRow.locator('.approval-regen-input').fill(feedback);

    // Submit
    await regenRow.locator('.approval-regen-submit').click();

    // Wait for draft body to update
    await expect(card.locator('.approval-card-body')).toHaveText(UPDATED_BODY, { timeout: 5000 });

    // The regen row should collapse
    await expect(regenRow).toBeHidden({ timeout: 3000 });

    // Confirm request shape
    expect(regenRequestBody).not.toBeNull();
    expect(regenRequestBody.inquiryId).toBe(MOCK_ITEM.inquiryId);
    expect(regenRequestBody.draftType).toBe('email');
    expect(regenRequestBody.addedContext).toBe(feedback);
    expect(regenRequestBody.existingDraft).toBe(MOCK_ITEM.body);

    // Approve button should be re-enabled
    await expect(card.locator('.approval-approve')).toBeEnabled();
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 4 — Add Details with input updates draft text
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 4. Add Details with input updates draft body`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);

    const UPDATED_BODY = 'Hi! Here is your quote. Note: event is for 75 people.';
    let detailsRequestBody = null;

    await page.route('**/api/ai/add-details', async r => {
      detailsRequestBody = await r.request().postDataJSON().catch(() => null);
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, body: UPDATED_BODY, draftType: 'email' }) });
    });

    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-test-001"]');
    await expect(card.locator('.approval-add-details')).toBeVisible({ timeout: 4000 });

    // Click Add Details — input row opens
    await card.locator('.approval-add-details').click();
    const detailsRow = card.locator('.approval-details-row');
    await expect(detailsRow).toBeVisible({ timeout: 2000 });

    // Type details
    const details = 'event is for 75 people';
    await detailsRow.locator('.approval-details-input').fill(details);

    // Submit
    await detailsRow.locator('.approval-details-submit').click();

    // Wait for draft body to update
    await expect(card.locator('.approval-card-body')).toHaveText(UPDATED_BODY, { timeout: 5000 });

    // The details row should collapse
    await expect(detailsRow).toBeHidden({ timeout: 3000 });

    // Confirm request shape
    expect(detailsRequestBody).not.toBeNull();
    expect(detailsRequestBody.inquiryId).toBe(MOCK_ITEM.inquiryId);
    expect(detailsRequestBody.draftType).toBe('email');
    expect(detailsRequestBody.extraContext).toBe(details);
    expect(detailsRequestBody.existingDraft).toBe(MOCK_ITEM.body);

    // Approve button should be re-enabled
    await expect(card.locator('.approval-approve')).toBeEnabled();
  });
}
