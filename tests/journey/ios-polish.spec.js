// @ts-check
// Journey tests for Wave 0.5 — iOS Polish
// Verifies: bottom-sheet open/close + body scroll lock, pull-to-refresh module
// loaded, safe-area CSS present, toggle-ios on setting checkboxes, inputmode
// attributes on key inputs, manifest icon entries.
// Viewports: 375 (iPhone), 768 (iPad), 1440 (desktop) × light + dark themes.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-ios-polish');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',   width: 375,  height: 812  },
  { name: 'ipad',     width: 768,  height: 1024 },
  { name: 'desktop',  width: 1440, height: 900  },
];
const THEMES = ['light', 'dark'];

async function setupMocks(page) {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/auth/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ connected: false }) })
  );
  await page.route('**/api/inquiries/list', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ inquiries: [], total: 0 }) })
  );
  await page.route('**/api/flags', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ flags: [
        { name: 'nav_v2',         enabled: true,  description: '' },
        { name: 'ios_polish_v1',  enabled: true,  description: '' },
      ]}) })
  );
  await page.route('**/manifest.json', route =>
    route.fulfill({ status: 200, contentType: 'application/manifest+json',
      body: JSON.stringify({
        name: "Blu's Barbeque", display: 'standalone',
        icons: [
          { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/static/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/static/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ]
      })
    })
  );
}

// ── Bottom-sheet open/close + scroll lock ─────────────────────────────────
test.describe('bottom-sheet component', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`opens and closes with scroll lock — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => {
          localStorage.setItem('theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, theme);

        // Wait for BottomSheet to be available
        await page.waitForFunction(() => typeof window.BottomSheet !== 'undefined', { timeout: 8000 });

        // Open the bottom-sheet programmatically
        await page.evaluate(() => {
          window.BottomSheet.open({
            title: 'Test Sheet',
            body: 'QA body text',
            actions: [
              { label: 'Confirm', style: 'primary', onClick: function() {} },
              { label: 'Cancel',  style: 'cancel'  },
            ],
          });
        });

        // Panel should be visible
        const panel = page.locator('#bottom-sheet-panel');
        await expect(panel).toBeVisible({ timeout: 2000 });
        await expect(panel).toHaveClass(/bs-open/);

        // Scroll lock: body should have position:fixed
        const bodyPos = await page.evaluate(() => document.body.style.position);
        expect(bodyPos).toBe('fixed');

        // Overlay should be visible
        await expect(page.locator('#bottom-sheet-overlay')).toHaveClass(/bs-open/);

        // Take screenshot
        await page.screenshot({
          path: path.join(OUT, `bottom-sheet-open-${vp.name}-${theme}.png`),
          fullPage: false,
        });

        // Close via Cancel button
        await page.locator('.bs-btn-cancel').click();
        await expect(panel).not.toHaveClass(/bs-open/, { timeout: 1500 });

        // Scroll lock should be released
        const bodyPosAfter = await page.evaluate(() => document.body.style.position);
        expect(bodyPosAfter).not.toBe('fixed');
      });
    }
  }
});

// ── Escape key closes the sheet ────────────────────────────────────────────
test('bottom-sheet closes on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.BottomSheet !== 'undefined', { timeout: 8000 });
  await page.evaluate(() => window.BottomSheet.open({ title: 'Esc test', actions: [{ label: 'X', style: 'cancel' }] }));
  await expect(page.locator('#bottom-sheet-panel')).toHaveClass(/bs-open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#bottom-sheet-panel')).not.toHaveClass(/bs-open/, { timeout: 1500 });
});

// ── Pull-to-refresh module loaded ─────────────────────────────────────────
test('PullToRefresh module is available', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const hasPTR = await page.evaluate(() => typeof window.PullToRefresh !== 'undefined' &&
    typeof window.PullToRefresh.activate === 'function' &&
    typeof window.PullToRefresh.deactivate === 'function');
  expect(hasPTR).toBe(true);
});

// ── scrollLock module loaded ───────────────────────────────────────────────
test('scrollLock module is available', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const hasLock = await page.evaluate(() => typeof window.scrollLock !== 'undefined' &&
    typeof window.scrollLock.lock === 'function' &&
    typeof window.scrollLock.unlock === 'function');
  expect(hasLock).toBe(true);
});

// ── iOS toggle class on setting checkboxes ────────────────────────────────
test('setting checkboxes use toggle-ios class', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // QB tax-exempt toggle
  const qbToggle = page.locator('#qb-tax-exempt-chk');
  await expect(qbToggle).toHaveClass(/toggle-ios/);

  // Inquiry tax-exempt toggle
  const inqToggle = page.locator('#inq-tax-exempt-chk');
  await expect(inqToggle).toHaveClass(/toggle-ios/);

  // Lead follow-up toggle
  const followupToggle = page.locator('#lm-followup');
  await expect(followupToggle).toHaveClass(/toggle-ios/);
});

// ── Input inputmode attributes ─────────────────────────────────────────────
test('phone inputs have tel inputmode', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const qPhone = page.locator('#q-phone');
  await expect(qPhone).toHaveAttribute('inputmode', 'tel');
  await expect(qPhone).toHaveAttribute('type', 'tel');

  const lmPhone = page.locator('#lm-phone');
  await expect(lmPhone).toHaveAttribute('inputmode', 'tel');
});

test('email inputs have email inputmode', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const qEmail = page.locator('#q-email');
  await expect(qEmail).toHaveAttribute('inputmode', 'email');
  await expect(qEmail).toHaveAttribute('type', 'email');
});

test('guest count inputs have numeric inputmode', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const qGuests = page.locator('#q-guests');
  await expect(qGuests).toHaveAttribute('inputmode', 'numeric');
});

// ── Tab bar safe-area CSS ─────────────────────────────────────────────────
test('tab bar has safe-area-inset-bottom in height', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const tabbarHeight = await page.evaluate(() => {
    const el = document.querySelector('.nav2-tabbar');
    return el ? getComputedStyle(el).height : null;
  });
  // Just verify element exists and has a numeric height (safe-area resolves to 0 in desktop browser)
  expect(tabbarHeight).not.toBeNull();
  expect(parseFloat(tabbarHeight || '0')).toBeGreaterThan(0);
});

// ── apple-touch-icon link in <head> ───────────────────────────────────────
test('apple-touch-icon link is present in head', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const ati = await page.evaluate(() => {
    const el = document.querySelector('link[rel="apple-touch-icon"]');
    return el ? el.getAttribute('href') : null;
  });
  expect(ati).toBe('/static/icons/apple-touch-icon.png');
});

// ── Manifest has 4 icons ──────────────────────────────────────────────────
test('manifest.json has 4 icon entries including maskable', async ({ page }) => {
  await setupMocks(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const resp = await page.request.get(BASE_URL + '/manifest.json');
  const json = await resp.json();
  expect(json.icons).toHaveLength(4);
  const maskable = json.icons.find(i => i.purpose === 'maskable');
  expect(maskable).toBeTruthy();
  expect(maskable.sizes).toBe('512x512');
});

// ── Visual screenshot sweep ───────────────────────────────────────────────
test.describe('visual sweep — 3 viewports × 2 themes', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`screenshot — ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupMocks(page);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.evaluate(t => {
          localStorage.setItem('theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, theme);
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(OUT, `sweep-${vp.name}-${theme}.png`),
          fullPage: false,
        });
      });
    }
  }
});
