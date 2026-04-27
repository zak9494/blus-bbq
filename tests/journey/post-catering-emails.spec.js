// @ts-check
//
// Journey test — post_catering_emails_v1 subsection of the Scheduled view.
//
// Verifies:
//   - Flag ON  : #pce-section visible; cards render from /api/scheduled/post-catering;
//                Cancel button DELETEs /api/tasks; empty state renders when list is empty.
//   - Flag OFF : #pce-section hidden.
//
// The endpoint is stubbed with page.route() so we don't have to seed real KV
// tasks (which would actually enqueue with QStash and risk firing real Gmail
// sends). The flag itself is set against the live API via setFlagOrSkip so the
// client-side window.flags.isEnabled() check exercises the real code path.
const { test, expect } = require('@playwright/test');
const { setFlagOrSkip } = require('../helpers/flags');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.INQ_SECRET || 'c857eb539774b63cf0b0a09303adc78d';

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 667  },
  { name: 'desktop', width: 1280, height: 900  },
];

const FLAG = 'post_catering_emails_v1';

const SAMPLE_ITEMS = [
  {
    taskId: 'task_pce_test_a',
    leadId: 'thread_pce_test_a',
    sendAt: '2099-01-02T15:00:00.000Z',
    status: 'scheduled',
    customer_name: 'Test Customer Alpha',
    event_date: '2099-01-01',
    subject: 'Thank you for catering with Blu\'s BBQ!',
    to: 'alpha@example.com',
    emailType: 'thank-you',
    qstashMessageId: 'qstash_a',
  },
  {
    taskId: 'task_pce_test_b',
    leadId: 'thread_pce_test_b',
    sendAt: '2099-01-09T15:00:00.000Z',
    status: 'scheduled',
    customer_name: 'Test Customer Bravo',
    event_date: '2099-01-01',
    subject: 'Mind leaving us a Google review?',
    to: 'bravo@example.com',
    emailType: 'review-request',
    qstashMessageId: 'qstash_b',
  },
];

async function gotoScheduled(page) {
  await page.goto(BASE_URL + '/#scheduled', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  // Make sure flags client has hydrated before showPage is invoked.
  await page.waitForFunction(
    () => window.flags && window.flags.isEnabled && typeof window.flags.isEnabled === 'function',
    { timeout: 10000 },
  );
  await page.evaluate(() => {
    if (typeof window.showPage === 'function') window.showPage('scheduled');
  });
  await page.waitForSelector('#page-scheduled', { timeout: 8000 });
}

// ── Flag ON ──────────────────────────────────────────────────────────────────

test.describe('post_catering_emails_v1 — subsection ON', () => {
  test.beforeAll(async ({ request }) => {
    await setFlagOrSkip(request, FLAG, true, { secret: SECRET, baseUrl: BASE_URL });
  });
  test.afterAll(async ({ request }) => {
    await setFlagOrSkip(request, FLAG, false, { secret: SECRET, baseUrl: BASE_URL });
  });

  for (const vp of VIEWPORTS) {
    test(`[${vp.name}] subsection visible and renders rows from endpoint`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.route('**/api/scheduled/post-catering**', async r => {
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, enabled: true, count: SAMPLE_ITEMS.length, items: SAMPLE_ITEMS }),
        });
      });

      await gotoScheduled(page);

      const section = page.locator('#pce-section');
      await expect(section).toBeVisible({ timeout: 8000 });
      await expect(page.locator('#pce-section h2')).toContainText('Post Catering Emails');

      // Cards rendered
      const cards = page.locator('#pce-list .pce-card');
      await expect(cards).toHaveCount(SAMPLE_ITEMS.length, { timeout: 8000 });

      // Customer + subject from first item visible
      await expect(page.locator('#pce-list')).toContainText('Test Customer Alpha');
      await expect(page.locator('#pce-list')).toContainText('Thank you for catering');
      await expect(page.locator('#pce-list')).toContainText('Test Customer Bravo');

      // Per-row action buttons present on each card
      await expect(cards.first().locator('.pce-view')).toBeVisible();
      await expect(cards.first().locator('.pce-edit')).toBeVisible();
      await expect(cards.first().locator('.pce-reschedule')).toBeVisible();
      await expect(cards.first().locator('.pce-cancel')).toBeVisible();
    });

    test(`[${vp.name}] empty state renders when endpoint returns no items`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.route('**/api/scheduled/post-catering**', async r => {
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, enabled: true, count: 0, items: [] }),
        });
      });

      await gotoScheduled(page);

      await expect(page.locator('#pce-section')).toBeVisible({ timeout: 8000 });
      const empty = page.locator('#pce-empty');
      await expect(empty).toBeVisible({ timeout: 8000 });
      await expect(empty).toContainText('No post-catering emails scheduled yet');
    });
  }

  test('[desktop] Cancel button DELETEs /api/tasks and re-renders', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    let listCallCount = 0;
    await page.route('**/api/scheduled/post-catering**', async r => {
      listCallCount++;
      // Second call (after cancel) returns one fewer item.
      const items = listCallCount === 1 ? SAMPLE_ITEMS : [SAMPLE_ITEMS[1]];
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, enabled: true, count: items.length, items }),
      });
    });

    let cancelTaskId = '';
    await page.route('**/api/tasks**', async r => {
      const url = new URL(r.request().url());
      if (r.request().method() === 'DELETE') {
        cancelTaskId = url.searchParams.get('taskId') || '';
        await r.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, taskId: cancelTaskId, status: 'cancelled' }),
        });
      } else {
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tasks: [] }) });
      }
    });

    // Auto-confirm the cancel prompt.
    page.on('dialog', d => d.accept());

    await gotoScheduled(page);

    const cards = page.locator('#pce-list .pce-card');
    await expect(cards).toHaveCount(SAMPLE_ITEMS.length, { timeout: 8000 });

    await cards.first().locator('.pce-cancel').click();

    await expect.poll(() => cancelTaskId, { timeout: 8000 }).toBe(SAMPLE_ITEMS[0].taskId);
    await expect(cards).toHaveCount(1, { timeout: 8000 });
  });
});

// ── Flag OFF ────────────────────────────────────────────────────────────────

test.describe('post_catering_emails_v1 — subsection OFF', () => {
  test.beforeAll(async ({ request }) => {
    await setFlagOrSkip(request, FLAG, false, { secret: SECRET, baseUrl: BASE_URL });
  });

  test('[desktop] subsection hidden when flag OFF', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // Even if endpoint were called, the client-side flag check should hide the section.
    await page.route('**/api/scheduled/post-catering**', async r => {
      await r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, enabled: false, count: 0, items: [], hint: 'flag off' }),
      });
    });

    await gotoScheduled(page);

    const section = page.locator('#pce-section');
    await expect(section).toBeHidden({ timeout: 8000 });

    // Pre-event Scheduled view is unaffected.
    await expect(page.locator('#page-scheduled')).toBeVisible();
    await expect(page.locator('#sched-list')).toBeAttached();
  });
});
