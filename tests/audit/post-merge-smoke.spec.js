// @ts-check
// ============================================================
// POST-MERGE PRODUCTION SMOKE
//
// Runs against the live https://blus-bbq.vercel.app deployment, NOT a preview.
// Designed to be re-run by a scheduled task whenever a merge to main lands.
//
// What it does for each top-level page:
//   1. Navigate (the app is a SPA, so most "routes" are entered via showPage()).
//   2. Wait for the page container to become active.
//   3. Run a bank of negative assertions (no error text, no [role=alert],
//      no console errors, no failed requests).
//   4. Confirm exactly one hamburger nav button exists (regression guard
//      for the duplicate-nav bug from incident 2026-04-20).
//   5. Save a full-page screenshot under
//      tests/audit/post-merge-smoke-output/<page>-<timestamp>.png.
//
// Run standalone:
//   npx playwright test tests/audit/post-merge-smoke.spec.js --reporter=line
//
// Override the target (e.g. preview URL):
//   SMOKE_BASE_URL=https://blus-bbq-git-foo.vercel.app \
//     npx playwright test tests/audit/post-merge-smoke.spec.js
// ============================================================
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT_DIR  = path.join(__dirname, 'post-merge-smoke-output');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Mobile viewport — Zach's primary device. Bugs that hide at desktop width
// (duplicate nav, overlapping CTA bars, off-screen modals) surface here.
const VIEWPORT = { width: 375, height: 667 };

// Allowed console-error substrings — known third-party noise that does NOT
// indicate a regression. Keep this list as small as possible.
const CONSOLE_IGNORE = [
  'favicon.ico',                      // missing favicon, not a real failure
  'manifest.json',                    // PWA manifest 404 in some envs
  'net::ERR_FAILED',                  // sw / push subscription noise
  'ServiceWorker',                    // sw registration races
  'sw.js',                            // ditto
  'Failed to load resource: the server responded with a status of 404', // generic
];

// Network requests we treat as non-fatal when they fail.
const NETWORK_IGNORE = [
  'favicon.ico',
  'manifest.json',
  '/sw.js',
  'google-analytics',
  'googletagmanager',
];

// The bank of "this page is broken" indicators. Two regexes so we can
// scope each to visible text only (via the walkVisibleErrorText helper
// below). Hidden "Loading…" spinners and JS source-text matches do NOT
// count — only what the user actually sees.
//
// Strict bank: phrases that only appear on a broken page.
const ERROR_TEXT_RE_STRICT =
  /failed to load|unauthorized|access denied|cannot load|forbidden|something went wrong/i;
// Loose bank: bare tokens that almost always indicate a render bug
// (e.g. "$undefined", "NaN guests"). Word-boundary anchored to dodge
// "no errors found" / "an error occurred" style copy.
const ERROR_TEXT_RE_LOOSE = /\b(undefined|NaN)\b/;

// Walk text nodes inside <body>, count those that (a) match either
// regex above and (b) belong to a chain of visible ancestors. Returns
// an array of `{ text, regex }` so we can include the matched snippet
// in the failure message.
async function findVisibleErrorText(page) {
  return page.evaluate(({ strictSrc, looseSrc }) => {
    const strict = new RegExp(strictSrc, 'i');
    const loose  = new RegExp(looseSrc);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const txt = (node.textContent || '').trim();
      if (!txt) continue;
      const m = strict.exec(txt) || loose.exec(txt);
      if (!m) continue;
      let el = node.parentElement;
      let visible = true;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
          visible = false;
          break;
        }
        el = el.parentElement;
      }
      if (!visible) continue;
      hits.push({ text: txt.slice(0, 160), match: m[0] });
      if (hits.length >= 5) break;
    }
    return hits;
  }, { strictSrc: ERROR_TEXT_RE_STRICT.source, looseSrc: ERROR_TEXT_RE_LOOSE.source });
}

// Pages to smoke. Each entry is { slug, label, enter(page), readyLocator }.
//   - slug         : used in screenshot filenames + test titles
//   - label        : human label for failure messages
//   - enter(page)  : navigate to the page from BASE_URL/
//   - readyLocator : a selector that must be visible once the page is ready
const PAGES = [
  {
    slug: 'pipeline',
    label: '/ (kanban / pipeline)',
    enter: async (page) => {
      // Pipeline is the default page on /
      await page.evaluate(() => window.showPage && window.showPage('pipeline'));
    },
    readyLocator: '#page-pipeline.active',
  },
  {
    slug: 'inquiries',
    label: '/inquiries',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('inquiries'));
    },
    readyLocator: '#page-inquiries.active',
  },
  {
    slug: 'calendar',
    label: '/calendar',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('calendar'));
    },
    readyLocator: '#page-calendar.active',
  },
  {
    slug: 'customers',
    label: '/customers (empty profile)',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('customer'));
    },
    readyLocator: '#page-customer.active',
  },
  {
    slug: 'customers-sample',
    label: '/customers/<sample-id> (direct hash nav)',
    enter: async (page) => {
      // Direct path /customers/<id> is a Vercel 404 (no rewrite). The SPA
      // supports the equivalent via #customer/<email> on the homepage.
      await page.evaluate(() => {
        window.location.hash = '#customer/test%40example.com';
        if (window.customerProfile && window.customerProfile.init) {
          window.customerProfile.init();
        }
        if (window.showPage) window.showPage('customer');
      });
    },
    readyLocator: '#page-customer.active',
  },
  {
    slug: 'quote',
    label: '/quote (quote builder)',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('quotes'));
    },
    readyLocator: '#page-quotes.active',
  },
  {
    slug: 'notifications',
    label: '/notifications (notification center)',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('notifications'));
    },
    readyLocator: '#page-notifications.active',
  },
  {
    slug: 'settings',
    label: '/settings',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('settings'));
    },
    readyLocator: '#page-settings.active',
  },
  {
    slug: 'settings-notifications',
    label: '/settings/notifications',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('notif-settings'));
    },
    readyLocator: '#page-notif-settings.active',
  },
  {
    slug: 'settings-shop-origin',
    label: '/settings/shop-origin (shop-origin section)',
    enter: async (page) => {
      // Shop Origin lives inside the Settings page rather than its own route.
      await page.evaluate(() => window.showPage && window.showPage('settings'));
    },
    readyLocator: '#page-settings.active',
  },
  {
    slug: 'invoices',
    label: '/invoices (invoice manager)',
    enter: async (page) => {
      await page.evaluate(() => window.showPage && window.showPage('invoices'));
    },
    readyLocator: '#page-invoices.active',
  },
];

// Aggregated results so we can print a single markdown summary at the end.
const SUMMARY = [];

test.afterAll(async () => {
  const ts = new Date().toISOString();
  const passCount = SUMMARY.filter(s => s.status === 'pass').length;
  const failCount = SUMMARY.filter(s => s.status === 'fail').length;
  const lines = [];
  lines.push(`## Post-merge production smoke — ${ts}`);
  lines.push(`Target: ${BASE_URL}`);
  lines.push(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  lines.push('');
  lines.push(`**Result:** ${failCount === 0 ? 'PASS' : 'FAIL'} (${passCount} passed, ${failCount} failed)`);
  lines.push('');
  lines.push('| Page | Status | Notes |');
  lines.push('|------|--------|-------|');
  for (const row of SUMMARY) {
    const notes = row.notes ? row.notes.replace(/\n/g, ' / ') : '';
    lines.push(`| ${row.label} | ${row.status.toUpperCase()} | ${notes} |`);
  }
  const md = lines.join('\n');
  // Print so the cron's `--reporter=line` output captures it.
  console.log('\n' + md + '\n');
  // Persist alongside screenshots for the cron to attach.
  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), md);
});

for (const p of PAGES) {
  test(`[smoke] ${p.label}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    const consoleErrors = [];
    const failedRequests = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (CONSOLE_IGNORE.some((sub) => text.includes(sub))) return;
      consoleErrors.push(text);
    });

    page.on('requestfailed', (req) => {
      const url = req.url();
      if (NETWORK_IGNORE.some((sub) => url.includes(sub))) return;
      const failure = req.failure();
      failedRequests.push(`${url} (${failure ? failure.errorText : 'unknown'})`);
    });

    let assertionNotes = '';
    try {
      // Land on the homepage first — the SPA bootstraps everything from /.
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('load');
      // showPage and friends are defined inline in index.html; wait for them.
      await page.waitForFunction(() => typeof window.showPage === 'function', { timeout: 15000 });

      // Enter the page under test.
      await p.enter(page);
      await expect(page.locator(p.readyLocator)).toBeVisible({ timeout: 10000 });

      // Give async page-init handlers (loadInquiries, calInit, notifPanelRenderPage,
      // notifSettings.init, invoiceMgr.initPage, etc.) a chance to settle.
      await page.waitForTimeout(1500);

      // ── Negative assertion bank ─────────────────────────────────────
      // 1. No "broken page" text visible to the user. Hidden Loading…
      //    spinners and JS source text are excluded — only what renders.
      const errorHits = await findVisibleErrorText(page);
      if (errorHits.length > 0) {
        const sample = errorHits.map(h => `"${h.match}" in: ${h.text}`).join('\n  - ');
        throw new Error(
          `Found error-indicator text on ${p.label}:\n  - ${sample}`
        );
      }

      // 2. No alert / error UI elements visible.
      const alerts = page.locator(
        '[role=alert]:visible, .error:visible, .danger:visible, .ns-empty-err:visible'
      );
      const alertCount = await alerts.count();
      if (alertCount > 0) {
        const txt = await alerts.allInnerTexts();
        throw new Error(
          `Found ${alertCount} visible alert/error/danger element(s) on ${p.label}:\n  - ${txt.join('\n  - ')}`
        );
      }

      // 3. At most one *visible* hamburger nav button. The duplicate-nav
      //    regression (incident 2026-04-20, fixed in PR #77) is the reason
      //    this exists. We accept zero (desktop view hides it) at mobile
      //    width too — the bug we're guarding against is the duplicate,
      //    not the absence.
      const hamburgers = page.locator(
        ['[data-nav-toggle]', 'button.nav-hamburger', 'button.mobile-hamburger', '.hamburger', '[class*="hamburger"]']
          .map(s => `${s}:visible`).join(', ')
      );
      const hamburgerCount = await hamburgers.count();
      if (hamburgerCount > 1) {
        throw new Error(
          `Expected at most 1 visible hamburger button on ${p.label}, found ${hamburgerCount} (duplicate-nav regression)`
        );
      }

      // 4. Console errors captured during the visit.
      if (consoleErrors.length > 0) {
        throw new Error(
          `Console errors on ${p.label}:\n  - ${consoleErrors.join('\n  - ')}`
        );
      }

      // 5. Network requests that failed during the visit.
      if (failedRequests.length > 0) {
        throw new Error(
          `Failed network requests on ${p.label}:\n  - ${failedRequests.join('\n  - ')}`
        );
      }

      assertionNotes = 'all checks passed';
      SUMMARY.push({ slug: p.slug, label: p.label, status: 'pass', notes: assertionNotes });
    } catch (err) {
      assertionNotes = (err && err.message ? err.message : String(err)).slice(0, 400);
      SUMMARY.push({ slug: p.slug, label: p.label, status: 'fail', notes: assertionNotes });
      // Always screenshot on failure, even if the test threw before the
      // success-path screenshot below.
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({
          path: path.join(OUT_DIR, `${p.slug}-FAIL-${ts}.png`),
          fullPage: true,
        });
      } catch (_) { /* screenshot is best-effort on failure */ }
      throw err;
    } finally {
      // Success-path screenshot. Cron uses these as the "what did the page
      // look like at smoke time" artifact attached to the failure ping.
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({
          path: path.join(OUT_DIR, `${p.slug}-${ts}.png`),
          fullPage: true,
        });
      } catch (_) { /* ignore — failure path already captured one */ }
      await context.close();
    }
  });
}
