// @ts-check
// Journey tests — AI send routing and auth fix
// Verifies:
//   1. AI-triggered SEND_EMAIL_NOW:: → approval card shown, no immediate /api/schedule call
//   2. Human-triggered SEND_EMAIL_NOW:: (source:'human') → /api/schedule called immediately, no card
//   3. "Approve & Send" on approval card → /api/schedule called (auth bug fix)
//   4. "📅 Schedule" on approval card → /api/schedule called with future sendAt
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-ai-send-routing');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'desktop', width: 1280, height: 900  },
];

const SAMPLE_AI_MSG = {
  to: 'customer@example.com',
  name: 'Test Customer',
  subject: 'AI draft subject',
  body: 'AI draft body',
  source: 'ai',
};

const SAMPLE_HUMAN_MSG = {
  to: 'customer@example.com',
  name: 'Test Customer',
  subject: 'Human compose subject',
  body: 'Human compose body',
  source: 'human',
};

async function setupMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: true, email: 'info@blusbarbeque.com' }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
  await page.route('**/api/chat/history*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, messages: [] }) }));
  await page.route('**/api/chat/approval*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [] }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [
        { name: 'nav_v2',             enabled: true,  description: '' },
        { name: 'kanban_restructure', enabled: true,  description: '' },
        { name: 'ios_polish_v1',      enabled: true,  description: '' },
      ]}) }));
}

async function navigateToAiPage(page) {
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    if (typeof showPage === 'function') await showPage('ai');
  });
  await page.waitForSelector('#chat-messages', { timeout: 15000 });
}

// ── 1. AI-triggered send → approval card shown, no immediate schedule call ────
test.describe('AI send → approval queue', () => {
  for (const vp of VIEWPORTS) {
    test(`approval card rendered, /api/schedule NOT called immediately — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      let scheduleHit = false;
      await setupMocks(page);
      await page.route('**/api/schedule', async r => {
        scheduleHit = true;
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, taskId: 'task_test_123', sendAt: new Date().toISOString() }) });
      });
      await page.route('**/api/chat/approval', async r => {
        if (r.request().method() === 'POST') {
          await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        } else {
          await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [] }) });
        }
      });

      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await navigateToAiPage(page);

      await page.evaluate((msg) => {
        window.sendPrompt('SEND_EMAIL_NOW::' + JSON.stringify(msg));
      }, SAMPLE_AI_MSG);

      // Approval card must appear
      await page.waitForSelector('.approval-card', { timeout: 8000 });
      const card = page.locator('.approval-card').first();
      await expect(card).toBeVisible();
      // Card shows correct recipient
      await expect(card).toContainText(SAMPLE_AI_MSG.to);
      // /api/schedule must NOT have fired yet (card is pending approval)
      expect(scheduleHit).toBe(false);

      await page.screenshot({ path: `${OUT}/ai-send-card-${vp.name}.png`, fullPage: false });
    });
  }
});

// ── 2. Human-triggered send → /api/schedule called immediately, no card ───────
test.describe('Human send → immediate fire, no approval card', () => {
  for (const vp of VIEWPORTS) {
    test(`/api/schedule called, no approval card — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await page.route('**/api/schedule', async r => {
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, taskId: 'task_test_456', sendAt: new Date().toISOString() }) });
      });

      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await navigateToAiPage(page);

      // Set up waitForRequest BEFORE calling sendPrompt
      const scheduleReqPromise = page.waitForRequest('**/api/schedule', { timeout: 8000 });

      await page.evaluate((msg) => {
        window.sendPrompt('SEND_EMAIL_NOW::' + JSON.stringify(msg));
      }, SAMPLE_HUMAN_MSG);

      // /api/schedule must have been called immediately
      const scheduleReq = await scheduleReqPromise;
      let schedulePayload = null;
      try { schedulePayload = scheduleReq.postDataJSON(); } catch (_) { /* non-fatal */ }

      // No approval card should appear
      const cards = page.locator('.approval-card');
      expect(await cards.count()).toBe(0);

      expect(schedulePayload).not.toBeNull();
      expect(schedulePayload.channel).toBe('email');
      expect(schedulePayload.payload.to).toBe(SAMPLE_HUMAN_MSG.to);

      await page.screenshot({ path: `${OUT}/human-send-no-card-${vp.name}.png`, fullPage: false });
    });
  }
});

// ── 3. Approve & Send on AI card → /api/schedule called (auth bug fix) ────────
test.describe('Approve & Send → /api/schedule called', () => {
  for (const vp of VIEWPORTS) {
    test(`approve button calls /api/schedule with correct payload — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await page.route('**/api/schedule', async r => {
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, taskId: 'task_test_789', sendAt: new Date().toISOString() }) });
      });
      await page.route('**/api/chat/approval', async r => {
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, items: [] }) });
      });

      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await navigateToAiPage(page);

      // Trigger AI send → shows approval card
      await page.evaluate((msg) => {
        window.sendPrompt('SEND_EMAIL_NOW::' + JSON.stringify(msg));
      }, SAMPLE_AI_MSG);

      await page.waitForSelector('.approval-approve', { timeout: 8000 });

      // Set up waitForRequest BEFORE clicking so we don't miss it
      const scheduleReqPromise = page.waitForRequest('**/api/schedule', { timeout: 10000 });

      await page.evaluate(() => document.querySelector('.approval-approve').click());

      // Capture request and parse payload synchronously
      const scheduleReq = await scheduleReqPromise;
      let schedulePayload = null;
      try { schedulePayload = scheduleReq.postDataJSON(); } catch (_) { /* non-fatal */ }

      expect(schedulePayload).not.toBeNull();
      expect(schedulePayload.channel).toBe('email');
      expect(schedulePayload.payload.to).toBe(SAMPLE_AI_MSG.to);
      expect(schedulePayload.payload.subject).toBe(SAMPLE_AI_MSG.subject);
      // sendAt should be roughly now (within 5 seconds)
      const sentAt = new Date(schedulePayload.sendAt).getTime();
      expect(Math.abs(sentAt - Date.now())).toBeLessThan(5000);

      await page.screenshot({ path: `${OUT}/approve-send-${vp.name}.png`, fullPage: false });
    });
  }
});

// ── 4. Schedule button on AI card → /api/schedule called with future sendAt ───
test.describe('Schedule button → /api/schedule with future time', () => {
  for (const vp of VIEWPORTS) {
    test(`schedule button calls /api/schedule with future sendAt — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await page.route('**/api/chat/approval', async r => {
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, items: [] }) });
      });
      // Capture the /api/schedule request via waitForRequest (avoids race with route handler)
      await page.route('**/api/schedule', async r => {
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, taskId: 'task_test_sched', sendAt: new Date().toISOString() }) });
      });

      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await navigateToAiPage(page);

      // Trigger AI send → shows approval card
      await page.evaluate((msg) => {
        window.sendPrompt('SEND_EMAIL_NOW::' + JSON.stringify(msg));
      }, SAMPLE_AI_MSG);

      await page.waitForSelector('.approval-schedule', { timeout: 8000 });

      // Set up waitForRequest BEFORE clicking so we don't miss it
      const scheduleReqPromise = page.waitForRequest('**/api/schedule', { timeout: 10000 });

      // Click via DOM to bypass sidebar overlap
      await page.evaluate(() => document.querySelector('.approval-schedule').click());
      // Wait for the schedule row to become visible (toggleScheduleRow sets display:flex)
      await page.waitForFunction(
        () => {
          const row = document.querySelector('.approval-schedule-row');
          return row && row.style.display === 'flex';
        },
        { timeout: 5000 }
      );

      // Set datetime to tomorrow 9 AM via JS to bypass visibility restriction
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      const dtValue = tomorrow.toISOString().slice(0, 16);
      await page.evaluate((v) => {
        const dt = document.querySelector('.approval-dt');
        if (dt) { dt.value = v; }
      }, dtValue);

      await page.evaluate(() => document.querySelector('.approval-send-scheduled').click());

      // Wait for the /api/schedule request to fire and capture it
      const scheduleReq = await scheduleReqPromise;
      let schedulePayload = null;
      try { schedulePayload = scheduleReq.postDataJSON(); } catch (_) { /* non-fatal */ }

      expect(schedulePayload).not.toBeNull();
      expect(schedulePayload.channel).toBe('email');
      const scheduledAt = new Date(schedulePayload.sendAt).getTime();
      // sendAt must be in the future
      expect(scheduledAt).toBeGreaterThan(Date.now());

      await page.screenshot({ path: `${OUT}/schedule-btn-${vp.name}.png`, fullPage: false });
    });
  }
});
