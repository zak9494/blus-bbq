/**
 * Journey test — email_thread_v2 iMessage-style thread view.
 * Verifies: bubble clustering renders, SMS toggle disabled, AI Draft routes to approval queue.
 *
 * Requires: BASE_URL and INQ_SECRET env vars (or defaults to prod + hardcoded secret).
 */
const { test, expect } = require('@playwright/test');
const { setFlagOrSkip } = require('../helpers/flags');

const BASE_URL  = process.env.SMOKE_BASE_URL || process.env.BASE_URL  || 'https://blus-bbq.vercel.app';
const SECRET    = process.env.INQ_SECRET || 'c857eb539774b63cf0b0a09303adc78d';

// ── Flag helpers ──────────────────────────────────────────────────────────────

async function setFlag(request, name, enabled) {
  return setFlagOrSkip(request, name, enabled, { secret: SECRET, baseUrl: BASE_URL });
}

// ── Shared navigation ─────────────────────────────────────────────────────────

async function openFirstInquiry(page) {
  // Navigate to inquiries list
  await page.goto(BASE_URL + '/#inquiries', { waitUntil: 'networkidle' });

  // Handle nav_v2 tab bar vs. sidebar link
  const navBtn = page.locator('[data-page="inquiries"], [onclick*="showPage(\'inquiries\')"]').first();
  if (await navBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await navBtn.click();
  }

  await page.waitForSelector('#page-inquiries:not([style*="display: none"])', { timeout: 8000 });

  // Wait for at least one inquiry card
  const card = page.locator('.inq-card, .k-card').first();
  const hasCard = await card.isVisible({ timeout: 6000 }).catch(() => false);
  if (!hasCard) return false;

  await card.click();

  // Wait for detail panel
  await page.waitForSelector(
    '#inq-detail-view:not([style*="display: none"])',
    { timeout: 8000 }
  );
  return true;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('email_thread_v2 — thread view', () => {
  test.beforeAll(async ({ request }) => {
    await setFlag(request, 'email_thread_v2', true);
  });

  test.afterAll(async ({ request }) => {
    await setFlag(request, 'email_thread_v2', false);
  });

  test('thread section visible and contains .tv-thread when flag ON', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    const section = page.locator('#inq-thread-section');
    await expect(section).toBeVisible({ timeout: 5000 });

    const thread = page.locator('.tv-thread');
    await expect(thread).toBeVisible({ timeout: 5000 });

    // Messages area present
    await expect(page.locator('.tv-msgs')).toBeVisible();

    // Composer present
    await expect(page.locator('.tv-composer')).toBeVisible();
  });

  test('at least one bubble or empty state renders after load', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    // Wait for thread to finish loading (loading div disappears)
    await page.waitForFunction(
      () => !document.querySelector('.tv-loading'),
      { timeout: 12000 }
    );

    const content = page.locator('.tv-bubble, .tv-empty');
    await expect(content.first()).toBeVisible({ timeout: 5000 });
  });

  test('bubble clustering: clusters have .tv-cluster-meta header', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    await page.waitForFunction(
      () => !document.querySelector('.tv-loading'),
      { timeout: 12000 }
    );

    const clusters = page.locator('.tv-cluster');
    const count = await clusters.count();
    if (count === 0) return; // empty thread — skip assertion

    const meta = clusters.first().locator('.tv-cluster-meta');
    await expect(meta).toBeVisible();
  });

  test('SMS toggle is disabled (coming soon)', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    await expect(page.locator('#tv-chan-sms')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tv-chan-sms')).toHaveClass(/tv-chan-disabled/);
  });

  test('View Email button hidden when flag ON', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    // The legacy View Email button should be hidden
    const emailBtn = page.locator('#inq-view-email-btn');
    await expect(emailBtn).toBeHidden({ timeout: 5000 });
  });

  test('AI Draft button posts to /api/chat/approval', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    await page.waitForSelector('.tv-composer', { timeout: 6000 });

    // Intercept the approval queue POST
    const approvalReq = page.waitForRequest(
      req => req.url().includes('/api/chat/approval') && req.method() === 'POST',
      { timeout: 20000 }
    );

    await page.locator('#tv-ai-draft-btn').click();

    // Confirm the request was made
    const req = await approvalReq;
    expect(req.url()).toContain('/api/chat/approval');

    // Confirm the posted body has expected shape
    const body = req.postDataJSON();
    expect(body).toHaveProperty('item');
    expect(body.item).toHaveProperty('to');
    expect(body.item).toHaveProperty('subject');
    expect(body.item).toHaveProperty('body');
  });
});

// ── Flag-OFF guard ────────────────────────────────────────────────────────────

test.describe('email_thread_v2 OFF — legacy view unchanged', () => {
  test.beforeAll(async ({ request }) => {
    await setFlag(request, 'email_thread_v2', false);
  });

  test('thread section hidden and View Email button visible when flag OFF', async ({ page }) => {
    const opened = await openFirstInquiry(page);
    if (!opened) test.skip(true, 'No inquiry cards available');

    await expect(page.locator('#inq-thread-section')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#inq-view-email-btn')).toBeVisible({ timeout: 5000 });
  });
});
