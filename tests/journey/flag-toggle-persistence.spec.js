// @ts-check
// Hotfix regression test — Feature Flag toggle MUST persist across refresh.
// Original bug: api/_lib/flags.js kvSet swallowed any HTTP error from the
// Upstash REST endpoint. POST /api/flags/<name> returned 200 {"ok":true} but
// the underlying KV write never landed. The toggle visually flipped (optimistic
// UI), then snapped back to OFF on next page load when the GET re-read the
// unchanged seed default. This blocked every flag-flip workflow (maps_v1,
// qb_ext_wave2, etc.).
//
// Fix: kvSet now uses the simple /set/<key> Upstash endpoint and rejects on
// any non-2xx status or non-OK pipeline result. The POST /api/flags handler
// surfaces those errors as 500 instead of falsely reporting success.
//
// This test toggles a low-impact flag (qb_ext_wave2), reloads the page,
// verifies the new state stuck, then restores the original state so the live
// KV record ends in the same state it started in.
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

const TARGET_FLAG = 'qb_ext_wave2';

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] flag toggle persists across refresh`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: vp.width, height: vp.height });

    /** @type {{status:number,url:string,body:string}[]} */
    const saveResponses = [];
    page.on('response', async r => {
      const u = r.url();
      if (u.includes(`/api/flags/${TARGET_FLAG}`)) {
        let body = '';
        try { body = await r.text(); } catch {}
        saveResponses.push({ status: r.status(), url: u, body });
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.flags && typeof window.flags.isEnabled === 'function', { timeout: 15000 });

    // Navigate to flags page.
    await page.evaluate(() => { if (window.showPage) window.showPage('flags'); });
    await expect(page.locator('#page-flags')).toHaveClass(/active/, { timeout: 5000 });

    // Wait for the list to render.
    const toggle = page.locator(`#flag-cb-${TARGET_FLAG}`);
    await toggle.waitFor({ state: 'attached', timeout: 10000 });

    // Capture initial state. The visible label/checkbox is wrapped in a custom
    // styled control — click the wrapping <label>.
    const initiallyOn = await toggle.isChecked();
    const desiredState = !initiallyOn;

    const wrappingLabel = page.locator(`label:has(#flag-cb-${TARGET_FLAG})`);
    await expect(wrappingLabel).toBeVisible({ timeout: 5000 });

    // Avoid the alert() the legacy error path triggers — short-circuit it.
    await page.evaluate(() => { window.alert = () => {}; });

    await wrappingLabel.click();
    await expect(toggle).toBeChecked({ checked: desiredState, timeout: 3000 });

    // Wait for the save POST to land.
    await page.waitForResponse(r => r.url().includes(`/api/flags/${TARGET_FLAG}`) && r.request().method() === 'POST',
      { timeout: 10000 });

    // Save POST must return 2xx — pre-fix it returned a fake 200 too, but
    // post-fix the body must report ok=true AND a follow-up GET must reflect
    // the new state.
    expect(saveResponses.length).toBeGreaterThan(0);
    for (const r of saveResponses) {
      expect(r.status, `flag save POST returned ${r.status} body=${r.body}`).toBeLessThan(400);
    }

    // Pre-refresh screenshot.
    await page.screenshot({
      path: path.join(OUT, `flag-toggle-on-${vp.name}.png`),
      fullPage: true,
    });

    // The smoking gun — refresh and assert the new state persisted.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await page.evaluate(() => { if (window.showPage) window.showPage('flags'); });
    const toggleAfter = page.locator(`#flag-cb-${TARGET_FLAG}`);
    await toggleAfter.waitFor({ state: 'attached', timeout: 10000 });
    const afterReload = await toggleAfter.isChecked();
    expect(afterReload, 'flag state must persist across page refresh').toBe(desiredState);

    // Post-refresh screenshot — the second of the pair the runbook requires.
    await page.screenshot({
      path: path.join(OUT, `flag-toggle-after-refresh-${vp.name}.png`),
      fullPage: true,
    });

    // Confirm the API agrees by reading /api/flags directly.
    const apiState = await page.evaluate(async (name) => {
      const r = await fetch('/api/flags');
      const d = await r.json();
      const f = (d.flags || []).find(x => x.name === name);
      return f ? f.enabled : null;
    }, TARGET_FLAG);
    expect(apiState).toBe(desiredState);

    // Restore original state. We can't always count on the visible label being
    // ready in time on slow renders — fall back to a direct API call so the
    // test is idempotent regardless of UI timing.
    await page.evaluate(async ({ name, enabled, secret }) => {
      await fetch('/api/flags/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, enabled }),
      });
    }, { name: TARGET_FLAG, enabled: initiallyOn, secret: 'c857eb539774b63cf0b0a09303adc78d' });
  });
}
