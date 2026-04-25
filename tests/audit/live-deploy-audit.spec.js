// @ts-check
/**
 * Live deployment audit — 2026-04-25
 *
 * Goal: smoke every visible surface in production at three viewports
 * (mobile/ipad/desktop), capture full-page screenshots, and assert no
 * obvious failure modes (error text, console errors, failed network
 * requests, duplicate hamburgers).
 *
 * Read-only — does not write to KV, click destructive buttons, or
 * mutate any data.
 *
 * The app is a SPA: pages are switched via window.showPage(name), not
 * URL routing. Each surface is reached by visiting BASE_URL and then
 * calling showPage in-page (plus any view-toggle JS for kanban/list).
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.AUDIT_BASE_URL || 'https://blus-bbq.vercel.app';
const SHOT_DIR = path.join(__dirname, '..', 'screenshots', 'audit-2026-04-25');
const FINDINGS_DIR = path.join(__dirname, '.findings');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(FINDINGS_DIR, { recursive: true });

// Each test writes a single JSON file with its findings + clean status.
// A separate aggregate script runs after Playwright to merge them
// across all workers into the final markdown report.
function writeTestResult(slug, viewport, findings, isClean) {
  const file = path.join(FINDINGS_DIR, `${slug}-${viewport}.json`);
  fs.writeFileSync(file, JSON.stringify({ slug, viewport, findings, isClean }, null, 2), 'utf8');
}

const VIEWPORTS = [
  { name: 'mobile',  width: 375,  height: 667  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 800  },
];

/**
 * Each surface describes how to navigate to it and any positive selector
 * that should be present once it's rendered. `area` groups findings in
 * the report.
 */
const SURFACES = [
  {
    slug: 'kanban',
    area: 'Kanban',
    label: 'Pipeline (kanban view)',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('pipeline'); });
      await page.evaluate(() => {
        if (typeof window.switchTab === 'function') {
          const el = document.querySelector('[data-view="kanban"]');
          window.switchTab('kanban', el);
        }
      });
    },
    expect: '#page-pipeline',
    positive: '#kanban-board',
  },
  {
    slug: 'list-view',
    area: 'List view',
    label: 'Pipeline (list view)',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('pipeline'); });
      await page.evaluate(() => {
        if (typeof window.switchTab === 'function') {
          const el = document.querySelector('[data-view="list"]');
          window.switchTab('list', el);
        }
      });
    },
    expect: '#page-pipeline',
    positive: '#view-list',
  },
  {
    slug: 'inquiries',
    area: 'Inquiries',
    label: 'Inquiries',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('inquiries'); });
    },
    expect: '#page-inquiries',
    positive: '#page-inquiries',
  },
  {
    slug: 'calendar',
    area: 'Calendar',
    label: 'Calendar',
    nav: async (page) => {
      await page.evaluate(() => {
        window.showPage && window.showPage('calendar');
        if (typeof window.calInit === 'function') window.calInit();
      });
    },
    expect: '#page-calendar',
    positive: '#page-calendar .cal-grid, #page-calendar .cal-day-grid, #cal-view-month',
  },
  {
    slug: 'customer-profile',
    area: 'Customer profile',
    label: 'Customer profile (drill-down)',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('customer'); });
    },
    expect: '#page-customer',
    positive: '#page-customer',
  },
  {
    slug: 'invoices',
    area: 'Invoices',
    label: 'Invoice Manager',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('invoices'); });
    },
    expect: '#page-invoices',
    positive: '#page-invoices',
  },
  {
    slug: 'quotes',
    area: 'Quote builder',
    label: 'Quote Builder',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('quotes'); });
    },
    expect: '#page-quotes',
    positive: '#page-quotes',
  },
  {
    slug: 'notifications',
    area: 'Notifications',
    label: 'Notifications center page',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('notifications'); });
    },
    expect: '#page-notifications',
    positive: '#page-notifications',
  },
  {
    slug: 'notif-settings',
    area: 'Notifications',
    label: 'Notification settings (the broken one)',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('notif-settings'); });
    },
    expect: '#page-notif-settings',
    positive: '#page-notif-settings',
  },
  {
    slug: 'settings',
    area: 'Settings',
    label: 'Settings (general)',
    nav: async (page) => {
      await page.evaluate(() => { window.showPage && window.showPage('settings'); });
    },
    expect: '#page-settings',
    positive: '#page-settings',
  },
  {
    slug: 'today',
    area: 'Today',
    label: 'Today (event-day-view)',
    nav: async (page) => {
      await page.evaluate(() => {
        window.showPage && window.showPage('today');
        if (typeof window.loadEventDayView === 'function') window.loadEventDayView();
      });
    },
    expect: '#page-today',
    positive: '#page-today',
  },
];

const ERROR_TEXT_RE = /\b(failed|error|unauthorized|denied|undefined|null|NaN)\b/i;

test.describe.configure({ mode: 'parallel' });

for (const surface of SURFACES) {
  for (const vp of VIEWPORTS) {
    test(`${surface.slug} @ ${vp.name}`, async ({ page }) => {
      const localFindings = [];
      const recordFinding = (f) => localFindings.push(f);
      const _surface = surface;
      const _vp = vp;
      const consoleErrors = [];
      const requestFailures = [];

      page.on('console', (msg) => {
        const t = msg.type();
        if (t === 'error' || t === 'warning') {
          consoleErrors.push({ type: t, text: msg.text() });
        }
      });
      page.on('pageerror', (err) => {
        consoleErrors.push({ type: 'pageerror', text: String(err && err.message || err) });
      });
      page.on('requestfailed', (req) => {
        const url = req.url();
        // Ignore third-party + favicon noise.
        if (/favicon\.ico$/.test(url)) return;
        requestFailures.push({ url, failure: req.failure()?.errorText || 'unknown' });
      });
      page.on('response', (resp) => {
        const status = resp.status();
        const url = resp.url();
        // Track only same-origin API failures (>=500 or 401/403/404 on /api/*).
        if (!/blus-bbq\.vercel\.app/.test(url)) return;
        if (status >= 400 && /\/api\//.test(url)) {
          requestFailures.push({ url, failure: `HTTP ${status}` });
        }
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Step 1: load the app shell.
      try {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 });
      } catch (e) {
        recordFinding({
          surface: surface.area,
          viewport: vp.name,
          kind: 'load-failure',
          detail: `Failed to load BASE_URL: ${String(e).slice(0, 200)}`,
          screenshot: '',
        });
        return;
      }

      // Wait briefly for flags + scripts to initialize.
      await page.waitForTimeout(1500);

      // Step 2: navigate to surface.
      try {
        await surface.nav(page);
      } catch (e) {
        recordFinding({
          surface: surface.area,
          viewport: vp.name,
          kind: 'nav-error',
          detail: `Navigation JS threw: ${String(e).slice(0, 200)}`,
          screenshot: '',
        });
      }

      // Allow renders + data fetches to settle.
      await page.waitForTimeout(2500);

      // Step 3: screenshot.
      const shotPath = path.join(SHOT_DIR, `${surface.slug}-${vp.name}.png`);
      try {
        await page.screenshot({ path: shotPath, fullPage: true });
      } catch (e) {
        // ignore — screenshot failure shouldn't crash the test.
      }

      const shotRel = path.relative(path.join(__dirname, '..', '..'), shotPath);

      let issues = 0;

      // -------- Negative: page container visible? --------
      try {
        const expectedSel = surface.expect;
        const isVisible = await page.locator(expectedSel).isVisible().catch(() => false);
        if (!isVisible) {
          recordFinding({
            surface: surface.area,
            viewport: vp.name,
            kind: 'page-not-visible',
            detail: `Expected container '${expectedSel}' is not visible after showPage('${surface.slug}')`,
            screenshot: shotRel,
          });
          issues++;
        }
      } catch {}

      // -------- Negative: visible error text in main content --------
      try {
        const bodyText = await page.locator('body').innerText({ timeout: 5000 });
        // Strip known-safe occurrences (e.g. labels/buttons that legitimately contain "error" word).
        const lines = bodyText.split('\n').map(s => s.trim()).filter(Boolean);
        const hits = [];
        for (const line of lines) {
          if (!ERROR_TEXT_RE.test(line)) continue;
          // Skip benign matches.
          if (/^(no errors|no failed|error rate|error budget)/i.test(line)) continue;
          if (/error log|error history/i.test(line)) continue;
          // Skip dropdown options / labels containing "Lost reason" etc.
          if (/^(reason|reasons|category)$/i.test(line)) continue;
          hits.push(line);
        }
        if (hits.length) {
          recordFinding({
            surface: surface.area,
            viewport: vp.name,
            kind: 'visible-error-text',
            detail: `Page shows error/null/undefined text in ${hits.length} line(s)`,
            snippet: hits.slice(0, 6).join(' | ').slice(0, 400),
            screenshot: shotRel,
          });
          issues++;
        }
      } catch {}

      // -------- Negative: no [role=alert], .error, .danger visible --------
      try {
        const alerts = await page.locator('[role="alert"]:visible, .error:visible, .danger:visible').count();
        if (alerts > 0) {
          const sample = await page.locator('[role="alert"]:visible, .error:visible, .danger:visible').first().innerText().catch(() => '');
          recordFinding({
            surface: surface.area,
            viewport: vp.name,
            kind: 'alert-element',
            detail: `${alerts} visible [role=alert]/.error/.danger element(s)`,
            snippet: sample.slice(0, 240),
            screenshot: shotRel,
          });
          issues++;
        }
      } catch {}

      // -------- Negative: hamburger nav button count exactly 1 --------
      // Production currently runs nav v1 (legacy). nav_v2 is OFF, so the
      // bottom tab bar is hidden. There should be exactly one hamburger.
      try {
        const hamburgers = await page.locator('[data-nav-toggle], button.nav-hamburger, .hamburger, button.mobile-hamburger').count();
        // On wide viewports the hamburger may be hidden by CSS; only count visible ones.
        const visibleHamburgers = await page.locator('[data-nav-toggle]:visible, button.nav-hamburger:visible, .hamburger:visible, button.mobile-hamburger:visible').count();
        if (vp.name === 'mobile' && visibleHamburgers !== 1) {
          recordFinding({
            surface: surface.area,
            viewport: vp.name,
            kind: 'hamburger-count',
            detail: `Expected exactly 1 visible hamburger on mobile, found ${visibleHamburgers} (DOM total ${hamburgers})`,
            screenshot: shotRel,
          });
          issues++;
        }
      } catch {}

      // -------- Negative: console errors / pageerrors --------
      // Filter out known-noisy benign messages.
      const meaningfulConsole = consoleErrors.filter(c => {
        if (c.type === 'warning') {
          // ignore deprecation/reportonly warnings; only retain interesting ones.
          if (/deprecat|will be removed/i.test(c.text)) return false;
        }
        // Service-worker manifest 404 etc. on first load are benign for audit.
        if (/Manifest:/i.test(c.text)) return false;
        return true;
      });
      if (meaningfulConsole.length) {
        recordFinding({
          surface: surface.area,
          viewport: vp.name,
          kind: 'console-errors',
          detail: `${meaningfulConsole.length} console error/pageerror entries`,
          snippet: meaningfulConsole.slice(0, 4).map(c => `[${c.type}] ${c.text}`).join(' || ').slice(0, 600),
          screenshot: shotRel,
        });
        issues++;
      }

      // -------- Negative: failed network requests (same-origin) --------
      // Dedup: surface only unique URLs.
      const uniqueFailures = Array.from(new Map(requestFailures.map(r => [r.url + '||' + r.failure, r])).values());
      if (uniqueFailures.length) {
        recordFinding({
          surface: surface.area,
          viewport: vp.name,
          kind: 'network-failures',
          detail: `${uniqueFailures.length} failed/4xx/5xx network request(s)`,
          snippet: uniqueFailures.slice(0, 5).map(r => `${r.failure} ${r.url}`).join(' || ').slice(0, 700),
          screenshot: shotRel,
        });
        issues++;
      }

      // -------- Positive: expected element renders --------
      try {
        const positiveCount = await page.locator(surface.positive).count();
        if (positiveCount === 0) {
          recordFinding({
            surface: surface.area,
            viewport: vp.name,
            kind: 'positive-missing',
            detail: `Expected positive selector '${surface.positive}' did not match any element`,
            screenshot: shotRel,
          });
          issues++;
        }
      } catch {}

      // -------- Surface-specific extras --------
      if (surface.slug === 'kanban') {
        try {
          // Kanban: each column header should be present (Needs Info / Quote Drafted / Quote Sent / Booked / Completed)
          const expectedCols = ['Needs Info', 'Quote Drafted', 'Quote Sent', 'Booked', 'Completed'];
          const missing = [];
          for (const col of expectedCols) {
            const c = await page.locator(`#page-pipeline >> text=${col}`).count();
            if (c === 0) missing.push(col);
          }
          if (missing.length) {
            recordFinding({
              surface: 'Kanban',
              viewport: vp.name,
              kind: 'missing-column',
              detail: `Kanban missing column header(s): ${missing.join(', ')}`,
              screenshot: shotRel,
            });
            issues++;
          }
        } catch {}
      }

      if (surface.slug === 'calendar') {
        try {
          // Calendar v2 status chips: Booked / Completed should be visible.
          const chipBooked = await page.locator('#page-calendar >> text=/^Booked$/').count();
          const chipCompleted = await page.locator('#page-calendar >> text=/^Completed$/').count();
          if (chipBooked === 0 && chipCompleted === 0) {
            recordFinding({
              surface: 'Calendar',
              viewport: vp.name,
              kind: 'calendar-chips-missing',
              detail: 'Calendar v2 status chips (Booked/Completed) not found — possible v2 filter regression',
              screenshot: shotRel,
            });
            issues++;
          }
          // Spot-check: cal-grid or month renders.
          const gridCount = await page.locator('#page-calendar .cal-grid, #page-calendar .cal-day-grid, #cal-view-month').count();
          if (gridCount === 0) {
            recordFinding({
              surface: 'Calendar',
              viewport: vp.name,
              kind: 'calendar-grid-missing',
              detail: 'Calendar grid elements not found (.cal-grid / #cal-view-month)',
              screenshot: shotRel,
            });
            issues++;
          }
        } catch {}
      }

      if (surface.slug === 'invoices') {
        try {
          // Invoice Manager: should have a list/empty-state container.
          const container = await page.locator('#page-invoices').first().innerText().catch(() => '');
          if (!container || container.trim().length < 5) {
            recordFinding({
              surface: 'Invoices',
              viewport: vp.name,
              kind: 'invoices-empty-shell',
              detail: 'Invoices page has empty/very-thin content — possible render failure',
              snippet: container.slice(0, 200),
              screenshot: shotRel,
            });
            issues++;
          }
        } catch {}
      }

      if (surface.slug === 'notif-settings') {
        try {
          // Look for 401/Unauthorized text on this page.
          const body = await page.locator('#page-notif-settings').innerText().catch(() => '');
          if (/401|unauthorized|forbidden/i.test(body)) {
            recordFinding({
              surface: 'Notifications',
              viewport: vp.name,
              kind: 'notif-settings-auth-error',
              detail: '401/Unauthorized text visible on notif-settings page',
              snippet: body.slice(0, 240),
              screenshot: shotRel,
            });
            issues++;
          }
        } catch {}
      }

      writeTestResult(surface.slug, vp.name, localFindings, issues === 0);
    });
  }
}

// Report aggregation runs as a separate node script after the playwright
// invocation completes (see tests/audit/aggregate-findings.js). afterAll
// hooks would run per-worker and clobber each other's data.
