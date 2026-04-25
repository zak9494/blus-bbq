// @ts-check
// Journey test — Pipeline alerts banner must not 401 on Kanban or List views.
// Regression guard for the INQ_SECRET vs SELF_MODIFY_SECRET mismatch fixed in PR #75
// (api/pipeline/alerts.js previously rejected the client-known INQ_SECRET literal,
// so stale-reply / past-due / unpaid / upcoming-48h alerts never displayed).
// Verifies: no 401 on /api/pipeline/alerts, #alerts-section is present in the DOM,
// and the section never renders error-shaped text.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-pipeline-alerts');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] Pipeline alerts banner — no 401 on Kanban + List views`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    /** @type {{ url: string, status: number }[]} */
    const alertsResponses = [];
    page.on('response', resp => {
      const url = resp.url();
      if (url.includes('/api/pipeline/alerts')) {
        alertsResponses.push({ url, status: resp.status() });
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    // pipelineAlertsInit fires from showPage('pipeline'). Arm the response-wait BEFORE
    // triggering the action so we never race the fetch.
    const alertsRespPromise = page.waitForResponse(
      r => r.url().includes('/api/pipeline/alerts'),
      { timeout: 15000 }
    );
    await page.evaluate(() => window.showPage && window.showPage('pipeline'));
    await expect(page.locator('#page-pipeline')).toHaveClass(/active/, { timeout: 5000 });
    await alertsRespPromise;

    // Kanban tab is the default-active view.
    const kanbanTab = page.locator('.tab[data-view="kanban"]');
    await expect(kanbanTab).toHaveClass(/active/);

    // The shared alerts banner element must exist in DOM.
    await expect(page.locator('#alerts-section')).toHaveCount(1);

    // No error-shaped contents.
    const kanbanText = (await page.locator('#alerts-section').textContent()) || '';
    expect(kanbanText).not.toMatch(/unauthorized/i);
    expect(kanbanText).not.toMatch(/failed/i);

    await page.screenshot({ path: path.join(OUT, `kanban-${vp.name}.png`), fullPage: true });

    // Switch to List view — the alerts banner is shared above both views.
    const listTab = page.locator('.tab[data-view="list"]');
    if (await listTab.count()) {
      await listTab.click();
      await expect(listTab).toHaveClass(/active/, { timeout: 4000 });
      await page.waitForTimeout(500);

      await expect(page.locator('#alerts-section')).toHaveCount(1);
      const listText = (await page.locator('#alerts-section').textContent()) || '';
      expect(listText).not.toMatch(/unauthorized/i);
      expect(listText).not.toMatch(/failed/i);

      await page.screenshot({ path: path.join(OUT, `list-${vp.name}.png`), fullPage: true });
    }

    // Core regression guard: no 401 on /api/pipeline/alerts during the journey.
    const unauthorized = alertsResponses.filter(r => r.status === 401);
    expect(unauthorized, `Got 401 on alerts endpoint: ${JSON.stringify(unauthorized)}`).toHaveLength(0);

    // At least one 200 must have come back.
    const ok = alertsResponses.filter(r => r.status === 200);
    expect(ok.length, `Expected at least one 200 from /api/pipeline/alerts, got: ${JSON.stringify(alertsResponses)}`).toBeGreaterThan(0);
  });
}
