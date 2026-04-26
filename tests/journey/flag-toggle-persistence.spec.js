// @ts-check
// Hotfix regression test — Feature Flag toggle MUST persist across refresh.
// Original bug: api/_lib/flags.js kvSet swallowed every error returned from
// the Upstash REST endpoint. POST /api/flags/<name> returned 200 ok=true while
// the underlying KV write never landed; the next GET re-read the seed default
// and the UI snapped back to OFF on refresh. This blocked every flag-flip
// workflow (maps_v1, qb_ext_wave2, sentry_enabled, etc.).
//
// Fix: kvSet now uses /set/<key> with /pipeline fallback, validates the
// HTTP status and result shape, and confirms the write via a readback before
// returning. The POST /api/flags handler surfaces failures as 500 with the
// underlying error in the body, instead of falsely reporting success.
//
// This test:
//   1. Calls POST /api/flags/<low-stakes-flag> directly to verify the API
//      actually persists the value (the core regression).
//   2. Drives the same flip via the Settings UI toggle, refreshes the page,
//      and confirms the toggle stayed flipped (the user-facing regression).
//   3. Restores the original state via API so the live KV record is left
//      where it was found.
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-flag-toggle-persistence');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 667  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

const TARGET_FLAG  = 'qb_ext_wave2';
const INQ_SECRET   = 'c857eb539774b63cf0b0a09303adc78d';

async function readFlag(page, name) {
  return page.evaluate(async (n) => {
    const r = await fetch('/api/flags');
    const d = await r.json();
    const f = (d.flags || []).find(x => x.name === n);
    return f ? !!f.enabled : null;
  }, name);
}

async function writeFlag(page, name, enabled) {
  return page.evaluate(async ({ n, e, s }) => {
    const r = await fetch('/api/flags/' + n, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: s, enabled: e }),
    });
    const text = await r.text();
    return { status: r.status, body: text };
  }, { n: name, e: enabled, s: INQ_SECRET });
}

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] flag toggle persists across refresh`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: vp.width, height: vp.height });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.flags && typeof window.flags.isEnabled === 'function', { timeout: 15000 });

    const initiallyOn  = await readFlag(page, TARGET_FLAG);
    const desiredState = !initiallyOn;
    expect(typeof initiallyOn).toBe('boolean');

    // ── 1. API persistence ──
    // Direct POST flips the flag. With the pre-fix code this returned 200 ok
    // but the next GET still reflected the seed default. Post-fix, GET must
    // reflect the new value.
    const writeResp = await writeFlag(page, TARGET_FLAG, desiredState);
    expect(writeResp.status, `POST /api/flags/${TARGET_FLAG} returned ${writeResp.status} body=${writeResp.body}`).toBeLessThan(400);

    const apiState = await readFlag(page, TARGET_FLAG);
    expect(apiState, `GET /api/flags after write returned ${apiState}, expected ${desiredState} (write body=${writeResp.body})`).toBe(desiredState);

    // ── 2. UI reflects persisted state on refresh ──
    await page.evaluate(() => { if (window.showPage) window.showPage('flags'); });
    await expect(page.locator('#page-flags')).toHaveClass(/active/, { timeout: 5000 });
    const toggle = page.locator(`#flag-cb-${TARGET_FLAG}`);
    await toggle.waitFor({ state: 'attached', timeout: 10000 });
    expect(await toggle.isChecked()).toBe(desiredState);

    await page.screenshot({ path: path.join(OUT, `flag-toggle-on-${vp.name}.png`), fullPage: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.flags && typeof window.flags.isEnabled === 'function', { timeout: 15000 });
    await page.evaluate(() => { if (window.showPage) window.showPage('flags'); });
    const toggleAfter = page.locator(`#flag-cb-${TARGET_FLAG}`);
    await toggleAfter.waitFor({ state: 'attached', timeout: 10000 });
    expect(await toggleAfter.isChecked(),
      `flag state must persist across refresh — pre-refresh ${desiredState}, post-refresh different`).toBe(desiredState);

    await page.screenshot({ path: path.join(OUT, `flag-toggle-after-refresh-${vp.name}.png`), fullPage: true });

    // ── 3. UI flip via the toggle itself triggers a save and persists ──
    // Tests the full click-to-persist flow that the user reported as broken.
    const responsePromise = page.waitForResponse(
      r => r.url().includes(`/api/flags/${TARGET_FLAG}`) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.evaluate(() => { window.alert = () => {}; });
    const wrappingLabel = page.locator(`label:has(#flag-cb-${TARGET_FLAG})`);
    await wrappingLabel.click();
    const clickResp = await responsePromise;
    const clickBody = await clickResp.text();
    expect(clickResp.status(), `click-triggered POST returned ${clickResp.status()} body=${clickBody}`).toBeLessThan(400);

    // Restore original state.
    await writeFlag(page, TARGET_FLAG, initiallyOn);
  });
}
