// @ts-check
// Journey test — Customer Profile direct navigation
// Verifies the fix for "page stuck at Loading… on direct navigation".
// Before the fix, calling showPage('customer') without first calling show(email)
// left #cp-loading visible forever because init() was a no-op.
//
// This spec covers three direct-nav paths:
//   1. Customer page opened with no email → renders an empty state (not stuck loading).
//   2. Hash-based deep link (#customer/<email>) → init() loads profile automatically.
//   3. Refresh after in-app navigation → sessionStorage + hash restore the customer.
//
// Viewports per CLAUDE.md: iPhone 375, iPad 768, desktop 1280.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-customer-profile-direct-nav');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const TEST_EMAIL = 'directnav@example.com';
const PROFILE_PAYLOAD = {
  ok: true,
  customer: {
    email: TEST_EMAIL,
    name: 'Direct Nav Customer',
    phone: '512-555-1212',
    totalEvents: 1,
    totalBilled: 1234,
    events: [{
      threadId: 'cp-direct-001',
      eventDate: '2026-05-10',
      subject: 'Backyard BBQ',
      status: 'booked',
      guestCount: 25,
      eventType: 'Birthday',
      serviceType: 'Delivery',
      quoteTotal: 1234,
      menuItems: ['Brisket', 'Ribs'],
      storedAt: '2026-04-10',
    }],
  },
  notes: 'Loves brisket',
};

async function setupMocks(page) {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, inquiries: [], total: 0 }) }));
  await page.route('**/api/customer/profile**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_PAYLOAD) }));
  await page.route('**/api/customers/tags**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, email: TEST_EMAIL, tags: [] }) }));
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [
      { name: 'customer_profile_v2', enabled: true, description: '' },
    ]}) }));
}

// ── 1. Customer page with no email → empty state, not stuck loading ─────────────
test.describe('Customer profile — empty state on no-email nav', () => {
  for (const vp of VIEWPORTS) {
    test(`renders empty state, hides #cp-loading — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

      // Simulate a user clicking the "Customers" nav button (showPage with no prior show()).
      await page.evaluate(() => {
        try { sessionStorage.removeItem('cp:lastEmail'); } catch (_) {}
        if (typeof showPage === 'function') showPage('customer');
      });

      // The original #cp-loading element must be gone (replaced by empty-state markup).
      const loadingVisible = await page.locator('#cp-loading').isVisible().catch(() => false);
      expect(loadingVisible).toBe(false);

      // Empty-state marker is rendered.
      const empty = page.locator('[data-cp-empty="1"]');
      await expect(empty).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: `${OUT}/empty-state-${vp.name}.png`, fullPage: false });
    });
  }
});

// ── 2. Hash-based deep link → init() loads the profile automatically ───────────
test.describe('Customer profile — hash deep link', () => {
  for (const vp of VIEWPORTS) {
    test(`#customer/<email> loads profile within 5s — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);

      // Direct navigation to the hash URL — fresh page, no prior in-app navigation.
      await page.goto(BASE_URL + '/#customer/' + encodeURIComponent(TEST_EMAIL), { waitUntil: 'load' });
      await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

      // Trigger the customer page; init() will detect the hash and call show().
      await page.evaluate(() => {
        if (window.customerProfile) window.customerProfile.init();
      });

      // The boilerplate #cp-loading must be replaced within 5s.
      await page.waitForFunction(() => {
        const el = document.getElementById('cp-loading');
        return !el || el.offsetParent === null;
      }, null, { timeout: 5000 });

      // Customer name renders.
      const name = page.locator('.cp-name');
      await expect(name).toContainText('Direct Nav Customer', { timeout: 5000 });

      // Notes section renders (textarea pre-populated).
      const notes = page.locator('#cp-notes-input');
      await expect(notes).toHaveValue('Loves brisket', { timeout: 5000 });

      // Event card renders.
      const eventCard = page.locator('.cp-event-card').first();
      await expect(eventCard).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: `${OUT}/hash-deeplink-${vp.name}.png`, fullPage: false });
    });
  }
});

// ── 3. Refresh after in-app nav → URL hash + sessionStorage restore the customer
test.describe('Customer profile — refresh restores last viewed', () => {
  for (const vp of VIEWPORTS) {
    test(`after show(), URL+storage persist; reload re-renders — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await setupMocks(page);
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

      // In-app navigation: show(email) should persist hash + sessionStorage.
      await page.evaluate(email => {
        if (window.customerProfile) window.customerProfile.show(email);
      }, TEST_EMAIL);
      await expect(page.locator('.cp-name')).toContainText('Direct Nav Customer', { timeout: 5000 });

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#customer/' + encodeURIComponent(TEST_EMAIL));

      const stored = await page.evaluate(() => sessionStorage.getItem('cp:lastEmail'));
      expect(stored).toBe(TEST_EMAIL);

      // Refresh — same URL, init() should re-discover and show the customer.
      await page.reload({ waitUntil: 'load' });
      await page.evaluate(async () => { if (window.flags) await window.flags.load(); });
      await page.evaluate(() => { if (window.customerProfile) window.customerProfile.init(); });

      await page.waitForFunction(() => {
        const el = document.getElementById('cp-loading');
        return !el || el.offsetParent === null;
      }, null, { timeout: 5000 });
      await expect(page.locator('.cp-name')).toContainText('Direct Nav Customer', { timeout: 5000 });

      await page.screenshot({ path: `${OUT}/refresh-restore-${vp.name}.png`, fullPage: false });
    });
  }
});
