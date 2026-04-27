// @ts-check
// Journey: Customer Profile — Previous Quotes section
// Verifies: section renders with Lost/Completed badges when flag ON,
//           only completed/declined events with a quoteTotal appear,
//           active/pending events are excluded from the quotes list.
// Viewports: 375, 768, 1280 × light + dark.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-cp-prev-quotes');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];
const THEMES = ['light', 'dark'];

const MOCK_PROFILE = {
  ok: true,
  notes: '',
  customer: {
    email: 'repeat@example.com',
    name: 'Repeat Customer',
    phone: null,
    totalBilled: 4200,
    totalEvents: 4,
    events: [
      // Should appear in Previous Quotes (completed + quoteTotal)
      {
        threadId: 'cp-pq-completed-001',
        status: 'completed',
        eventDate: '2025-09-15',
        subject: 'Birthday Party',
        guestCount: 80,
        quoteTotal: 2400,
        storedAt: '2025-09-15T00:00:00Z',
      },
      // Should appear in Previous Quotes (declined + quoteTotal) — label: Lost
      {
        threadId: 'cp-pq-declined-001',
        status: 'declined',
        eventDate: '2025-11-20',
        subject: 'Corporate Lunch',
        guestCount: 50,
        quoteTotal: 1800,
        storedAt: '2025-11-20T00:00:00Z',
      },
      // Should NOT appear in Previous Quotes (active status)
      {
        threadId: 'cp-pq-active-001',
        status: 'quote_sent',
        eventDate: '2026-06-10',
        subject: 'Wedding Rehearsal',
        guestCount: 100,
        quoteTotal: 3500,
        storedAt: '2026-04-01T00:00:00Z',
      },
      // Should NOT appear in Previous Quotes (no quoteTotal)
      {
        threadId: 'cp-pq-noquote-001',
        status: 'completed',
        eventDate: '2024-05-01',
        subject: 'Old Event No Quote',
        guestCount: 30,
        quoteTotal: 0,
        storedAt: '2024-05-01T00:00:00Z',
      },
    ],
  },
};

async function setupMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/notifications/counts', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ unread: 0 }) }));
  await page.route('**/api/customer/profile**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_PROFILE) }));
  await page.route('**/api/customer/notes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, tags: [] }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [
        { name: 'customer_profile_v2', enabled: true,  description: '' },
        { name: 'nav_v2',              enabled: true,  description: '' },
        { name: 'kanban_restructure',  enabled: false, description: '' },
      ]}) }));
}

async function openCustomerProfile(page) {
  await page.evaluate(async () => {
    if (window.flags && typeof window.flags.load === 'function') await window.flags.load();
    if (typeof window.customerProfile !== 'undefined' && typeof window.customerProfile.show === 'function') {
      window.customerProfile.show('repeat@example.com');
    } else if (typeof openCustomerProfile === 'function') {
      openCustomerProfile('repeat@example.com', 'Repeat Customer');
    } else {
      if (typeof showPage === 'function') showPage('customer');
    }
  });
  // Wait for profile content to render
  await page.waitForSelector('.cp-timeline-hdr', { timeout: 10000 });
}

// ── Previous Quotes section renders ──────────────────────────────────────────
test.describe('Customer Profile — Previous Quotes section renders', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`Previous Quotes header visible — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await openCustomerProfile(page);

        // "Previous Quotes (2)" header should be present (2 qualifying events)
        const headers = page.locator('.cp-timeline-hdr');
        const headerTexts = await headers.allInnerTexts();
        const pqHeader = headerTexts.find(t => t.startsWith('Previous Quotes'));
        expect(pqHeader).toBeTruthy();
        expect(pqHeader).toContain('2');

        await page.screenshot({ path: `${OUT}/pq-renders-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Lost badge renders for declined event ─────────────────────────────────────
test.describe('Customer Profile — Lost badge for declined events', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`Lost badge visible — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await openCustomerProfile(page);

        const pqList = page.locator('.cp-pq-list');
        await expect(pqList).toBeVisible();

        const listText = await pqList.innerText();
        expect(listText).toContain('Lost');

        await page.screenshot({ path: `${OUT}/lost-badge-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Completed badge renders ───────────────────────────────────────────────────
test.describe('Customer Profile — Completed badge for completed events', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`Completed badge visible — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL + '/', { waitUntil: 'load' });
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await openCustomerProfile(page);

        const pqList = page.locator('.cp-pq-list');
        await expect(pqList).toBeVisible();

        const listText = await pqList.innerText();
        expect(listText).toContain('Completed');

        await page.screenshot({ path: `${OUT}/completed-badge-${vp.name}-${theme}.png`, fullPage: false });
      });
    }
  }
});

// ── Active/pending events excluded from Previous Quotes ───────────────────────
test.describe('Customer Profile — active events excluded from Previous Quotes', () => {
  test('only 2 rows in .cp-pq-list (not 3 or 4)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await openCustomerProfile(page);

    const rows = page.locator('.cp-pq-row');
    await expect(rows).toHaveCount(2);
  });

  test('active subject not in Previous Quotes list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await openCustomerProfile(page);

    const pqList = page.locator('.cp-pq-list');
    const listText = await pqList.innerText();
    // "Wedding Rehearsal" is the active quote_sent event — must not appear in Previous Quotes
    expect(listText).not.toContain('Wedding Rehearsal');
  });
});

// ── Event History still renders all events ────────────────────────────────────
test.describe('Customer Profile — Event History unaffected', () => {
  test('Event History header still present with full count', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupMocks(page);
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await openCustomerProfile(page);

    const headers = page.locator('.cp-timeline-hdr');
    const headerTexts = await headers.allInnerTexts();
    const ehHeader = headerTexts.find(t => t.startsWith('Event History'));
    expect(ehHeader).toBeTruthy();
    expect(ehHeader).toContain('4');
  });
});
