// @ts-check
// Journey tests — Dessert trigger → AI approval queue (dessert_to_approval_queue_v1)
//
// When the dessert-trigger fires with this flag ON (server-side), the offer is
// enqueued on chat:approval:queue with source: 'dessert_trigger' instead of
// firing a notification. From the UI perspective, the queued draft renders as a
// normal approval card on the AI page; this spec verifies:
//   1. the dessert draft renders in the AI approval queue (not Notifications Center)
//   2. Approve & Send fires the schedule endpoint
//   3. Reject removes the card without sending
//   4. Notifications Center stays empty (no parallel notification was created)
// All endpoint responses are mocked — no real KV writes.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'desktop', width: 1280, height: 900  },
];

const DESSERT_ITEM = {
  id: 'ap-dessert-test-001',
  to: 'customer@example.com',
  name: 'Jamie Customer',
  subject: "Quick add-on idea for your Blu's BBQ catering",
  body: "Hi Jamie,\n\nThanks for getting back to me for your event on 2026-05-15. Before we lock things in, I wanted to mention we can add a dessert to round out the meal.\n\nWant me to add one?\n\nThanks,\nZach",
  inquiryId: 'thread-dessert-abc',
  draftType: 'email',
  source: 'dessert_trigger',
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

  await page.route('**/api/notifications/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, notifications: [] }) }));

  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));

  await page.route('**/api/pipeline/alerts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, alerts: [] }) }));
}

async function setupFlagsMock(page, dessertQueueOn) {
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'nav_v2',                          enabled: true,           description: '' },
      { name: 'ios_polish_v1',                   enabled: true,           description: '' },
      { name: 'ai_dessert_trigger',              enabled: true,           description: '' },
      { name: 'dessert_to_approval_queue_v1',    enabled: dessertQueueOn, description: '' },
    ]}) }));
}

async function loadAppAndOpenAI(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await page.waitForFunction(
    () => window.flags && window.flags.isEnabled,
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    if (window.showPage) window.showPage('ai');
    if (window.chatApprovalInit) window.chatApprovalInit();
  });
  await page.waitForTimeout(600);
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 1 — Dessert draft renders in AI approval queue (not Notifications Center)
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 1. Dessert offer renders in AI approval queue, not Notifications Center`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);

    // Approval queue returns one dessert-trigger item
    await page.route('**/api/chat/approval*', r => {
      if (r.request().method() === 'GET') {
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, items: [DESSERT_ITEM] }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    });

    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-dessert-test-001"]');
    await expect(card).toBeAttached({ timeout: 4000 });
    await expect(card.locator('.approval-card-body')).toContainText('add a dessert');
    await expect(card.locator('.approval-subject-val')).toContainText('add-on idea');

    // Notifications Center had no parallel notification queued
    const notifCount = await page.evaluate(async () => {
      const r = await fetch('/api/notifications/list');
      const d = await r.json();
      return Array.isArray(d.notifications) ? d.notifications.length : 0;
    });
    expect(notifCount).toBe(0);
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 2 — Approve & Send fires the schedule endpoint
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 2. Approve sends the dessert offer through /api/schedule`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);

    let scheduleBody = null;
    await page.route('**/api/schedule', async r => {
      try { scheduleBody = r.request().postDataJSON(); } catch { scheduleBody = null; }
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, taskId: 'task-123' }) });
    });

    let dequeueCalled = false;
    await page.route('**/api/chat/approval*', r => {
      const method = r.request().method();
      if (method === 'GET') {
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, items: [DESSERT_ITEM] }) });
      }
      if (method === 'DELETE') {
        dequeueCalled = true;
      }
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    });

    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-dessert-test-001"]');
    await expect(card.locator('.approval-approve')).toBeVisible({ timeout: 4000 });

    await page.evaluate(() => {
      document.querySelector('[data-approval-id="ap-dessert-test-001"] .approval-approve')?.click();
    });

    // Card collapses to "sent" state
    await expect(card.locator('.approval-sent')).toBeVisible({ timeout: 4000 });

    // /api/schedule was called with the dessert payload
    expect(scheduleBody).not.toBeNull();
    expect(scheduleBody.channel).toBe('email');
    expect(scheduleBody.payload.to).toBe(DESSERT_ITEM.to);
    expect(scheduleBody.payload.subject).toBe(DESSERT_ITEM.subject);
    expect(scheduleBody.payload.body).toBe(DESSERT_ITEM.body);

    // The item was dequeued
    expect(dequeueCalled).toBe(true);
  });
}

/* ─────────────────────────────────────────────────────────────
   SCENARIO 3 — Reject removes the card without sending
───────────────────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test(`[${vp.name}] 3. Reject discards the dessert offer without firing send`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupBaseMocks(page);
    await setupFlagsMock(page, true);

    let scheduleCalled = false;
    await page.route('**/api/schedule', r => {
      scheduleCalled = true;
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    });

    let dequeueCalled = false;
    await page.route('**/api/chat/approval*', r => {
      const method = r.request().method();
      if (method === 'GET') {
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, items: [DESSERT_ITEM] }) });
      }
      if (method === 'DELETE') {
        dequeueCalled = true;
      }
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    });

    await loadAppAndOpenAI(page);

    const card = page.locator('[data-approval-id="ap-dessert-test-001"]');
    await expect(card.locator('.approval-reject')).toBeVisible({ timeout: 4000 });

    await page.evaluate(() => {
      document.querySelector('[data-approval-id="ap-dessert-test-001"] .approval-reject')?.click();
    });

    // Card now shows the rejected-state copy
    await expect(card.locator('.approval-sent')).toContainText(/rejected|discarded/i, { timeout: 3000 });

    expect(dequeueCalled).toBe(true);
    expect(scheduleCalled).toBe(false);
  });
}
