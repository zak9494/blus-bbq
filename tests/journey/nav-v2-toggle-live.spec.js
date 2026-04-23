// @ts-check
// Journey: nav_v2 settings toggle activates bottom-tab-bar in-place
//
// Regression guard for: toggleFlag() was not calling navV2.init() after reload,
// so turning nav_v2 ON in Settings had no visible effect until a full page reload.
//
// Golden-path flow:
//   1. Load page with nav_v2 = false → .app does NOT have nav-v2-active
//   2. Navigate to Flags settings page — click the nav_v2 toggle checkbox
//   3. toggleFlag() POSTs to API, reloads cache, then calls navV2.init() (the fix)
//   4. Assert .app has nav-v2-active WITHOUT any page.reload()
//
// Mock strategy: only the /api/flags endpoints are intercepted; everything else
// (auth/status, inquiries/list, etc.) hits the real Vercel deploy so the full
// page boots correctly. Route specificity: Playwright processes routes in LIFO
// order, so more-specific routes must be registered last (highest priority).

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-nav-v2-toggle');
fs.mkdirSync(OUT, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function flagsBody(navV2) {
  return JSON.stringify({ ok: true, flags: [
    { name: 'nav_v2',        enabled: navV2, description: 'Nav v2 — bottom tab bar' },
    { name: 'ios_polish_v1', enabled: true,  description: '' },
  ]});
}

// Wait until window.flags has loaded its cache and the load-event init has run.
// Calling window.flags.load() in evaluate() joins the same in-flight Promise that
// the page's load handler awaits; because the handler's .then() was registered
// first it runs before our continuation — meaning navV2.init() has already fired
// by the time our await resolves.
async function waitForFlagsInit(page) {
  await page.evaluate(async () => {
    if (window.flags) await window.flags.load();
    // Flush one extra tick so navV2.init()'s inner flags.load .then has run
    await new Promise(r => setTimeout(r, 0));
  });
}

// ── Test 1: golden path — toggle ON activates nav without a page reload ───────

test('toggling nav_v2 ON activates bottom-tab-bar without a page reload', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });

  // State shared between the GET and POST handlers.
  // Starts false; the POST mock flips it so the next GET returns nav_v2: true.
  let navV2Enabled = false;

  // GET /api/flags — returns current navV2Enabled state.
  // Registered before the POST handler so POST handler has higher LIFO priority.
  await page.route('**/api/flags', route => {
    if (route.request().method() !== 'GET') return route.continue();
    route.fulfill({ status: 200, contentType: 'application/json',
      body: flagsBody(navV2Enabled) });
  });

  // POST /api/flags/nav_v2 — records the flip, returns success.
  // Registered last → highest LIFO priority → handled before **/api/flags.
  await page.route('**/api/flags/nav_v2', route => {
    if (route.request().method() !== 'POST') return route.continue();
    navV2Enabled = true;
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: 'nav_v2', enabled: true,
        updated_at: new Date().toISOString() }) });
  });

  // Load page — nav_v2 is OFF
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await waitForFlagsInit(page);

  // 1. Confirm nav-v2 is NOT active at load
  const activeAtLoad = await page.evaluate(() =>
    document.querySelector('.app')?.classList.contains('nav-v2-active') ?? false
  );
  expect(activeAtLoad).toBe(false);

  const tabbarAtLoad = await page.evaluate(() => {
    const el = document.getElementById('nav-v2-tabbar');
    return el ? getComputedStyle(el).display : 'not-found';
  });
  expect(tabbarAtLoad).toBe('none');

  // 2. Navigate to the flags settings page
  await page.evaluate(() => window.showPage('flags'));

  // Wait for the nav_v2 checkbox to appear (loadFlagsPage() async render)
  const navV2Cb = page.locator('#flag-cb-nav_v2');
  await expect(navV2Cb).toBeVisible({ timeout: 6000 });
  await expect(navV2Cb).not.toBeChecked();

  // 3. Click — fires the real toggleFlag('nav_v2', true, …) in the page context
  await navV2Cb.click();

  // 4. Without page.reload(), assert .app gets nav-v2-active.
  //    This assertion fails on unfixed code (pre-fix toggleFlag never called navV2.init()).
  await page.waitForFunction(
    () => document.querySelector('.app')?.classList.contains('nav-v2-active'),
    { timeout: 6000 }
  );

  // Bottom tab bar must now be visible
  const tabbarVisible = await page.evaluate(() => {
    const el = document.getElementById('nav-v2-tabbar');
    return el ? getComputedStyle(el).display !== 'none' : false;
  });
  expect(tabbarVisible).toBe(true);

  // Old sidebar must be hidden by .nav-v2-active > .sidebar { display: none !important }
  const oldSidebarHidden = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return el ? getComputedStyle(el).display === 'none' : true;
  });
  expect(oldSidebarHidden).toBe(true);

  await page.screenshot({ path: path.join(OUT, 'nav-v2-activated-after-toggle-375.png') });
});

// ── Test 2: baseline — nav NOT active when flag starts false ─────────────────

test('nav-v2 is NOT active on load when flag starts false', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/flags', route => {
    if (route.request().method() !== 'GET') return route.continue();
    route.fulfill({ status: 200, contentType: 'application/json',
      body: flagsBody(false) });
  });

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await waitForFlagsInit(page);

  const active = await page.evaluate(() =>
    document.querySelector('.app')?.classList.contains('nav-v2-active') ?? false
  );
  expect(active).toBe(false);
});

// ── Test 3: baseline — nav IS active when flag starts true ───────────────────

test('nav-v2 IS active on load when flag starts true', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/flags', route => {
    if (route.request().method() !== 'GET') return route.continue();
    route.fulfill({ status: 200, contentType: 'application/json',
      body: flagsBody(true) });
  });

  await page.goto(BASE_URL, { waitUntil: 'load' });

  await page.waitForFunction(
    () => document.querySelector('.app')?.classList.contains('nav-v2-active'),
    { timeout: 8000 }
  );

  const active = await page.evaluate(() =>
    document.querySelector('.app')?.classList.contains('nav-v2-active') ?? false
  );
  expect(active).toBe(true);

  await page.screenshot({ path: path.join(OUT, 'nav-v2-active-on-load-375.png') });
});
