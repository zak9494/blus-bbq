// @ts-check
// Journey test — Pipeline kanban card click for quoted statuses opens Quote Revise.
//
// Bug 1: Cards in statuses {quote_drafted, quote_approved, quote_sent} previously
//        routed to the Inquiries detail view, even though the user almost always
//        wants to edit pricing/lines (i.e. revise the quote) for those statuses.
//        Fix routes them through window.quoteReviseOpen() instead.
//
// Bug 2: quoteReviseOpen() previously hydrated form fields from element IDs that
//        do not exist in index.html (q-sc-pct, q-delivery-fee, q-tax-exempt).
//        Fix uses the real IDs (charge-pct, delivery-fee-input, qb-tax-exempt-chk).
//        It also adds delivery_full to the service-type radio whitelist.
//
// Verifies via stubbed inquiries API:
//   - Clicking a card with status=quote_drafted lands on the Quote Builder page.
//   - The revision banner (#qb-revision-banner) appears (only present when
//     quoteReviseOpen runs).
//   - The pricing inputs are populated from the stubbed quote (charge-pct,
//     delivery-fee-input, qb-tax-exempt-chk).
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.QA_BASE_URL || 'https://blus-bbq.vercel.app';
const OUT = path.join(__dirname, '../../outputs/qa-qb-pipeline-click');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

// One inquiry per "has-a-quote" status. quote_drafted is the one we click.
const STUB_INQUIRIES = [
  {
    threadId: 'qb-click-drafted',
    customer_name: 'Drafted Customer',
    from: 'drafted@example.com',
    subject: 'Drafted quote test',
    status: 'quote_drafted',
    approved: true,
    event_date: '2026-06-01',
    guest_count: 50,
    has_unreviewed_update: false,
  },
  {
    threadId: 'qb-click-approved',
    customer_name: 'Approved Customer',
    from: 'approved@example.com',
    subject: 'Approved quote test',
    status: 'quote_approved',
    approved: true,
    event_date: '2026-06-02',
    guest_count: 25,
    has_unreviewed_update: false,
  },
  {
    threadId: 'qb-click-sent',
    customer_name: 'Sent Customer',
    from: 'sent@example.com',
    subject: 'Sent quote test',
    status: 'quote_sent',
    approved: true,
    event_date: '2026-06-03',
    guest_count: 75,
    has_unreviewed_update: false,
  },
];

// Full inquiry record returned by /api/inquiries/get for the drafted one we click.
// The pricing controls should pick up these values via charge-pct / delivery-fee-input
// / qb-tax-exempt-chk after the hydration-IDs fix.
const STUB_DRAFTED_FULL = {
  threadId: 'qb-click-drafted',
  customer_name: 'Drafted Customer',
  from: 'Drafted Customer <drafted@example.com>',
  subject: 'Drafted quote test',
  status: 'quote_drafted',
  approved: true,
  event_date: '2026-06-01',
  guest_count: 50,
  extracted_fields: {
    customer_name: 'Drafted Customer',
    customer_email: 'drafted@example.com',
    event_date: '2026-06-01',
    guest_count: 50,
    delivery_address: '123 Test St',
    service_type: 'delivery_full',
    notes: 'Hydration test',
  },
  quote: {
    line_items: [
      { name: 'Brisket (sliced)', qty: 10, unit_price: 31.99 },
    ],
    service_charge_pct: 12,
    delivery_fee: 75,
    tax_exempt: false,
  },
};

async function setupMocks(page) {
  // Catch-all so we don't hit prod KV mid-test.
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/auth/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
  await page.route('**/api/inquiries/list*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, inquiries: STUB_INQUIRIES, total: STUB_INQUIRIES.length }) }));
  await page.route('**/api/inquiries/get*', r => {
    const url = r.request().url();
    if (url.includes('qb-click-drafted')) {
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, inquiry: STUB_DRAFTED_FULL }) });
    } else {
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, inquiry: { threadId: 'unknown', status: 'new' } }) });
    }
  });
  // Keep the alerts banner quiet.
  await page.route('**/api/pipeline/alerts*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, alerts: [] }) }));
  // Default flags off — we don't need any v2 surface for this test.
  await page.route('**/api/flags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [] }) }));
}

for (const vp of VIEWPORTS) {
  test(`[${vp.name}] Pipeline card (quote_drafted) opens Quote Revise + hydrates pricing`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setupMocks(page);

    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await page.evaluate(async () => { if (window.flags) await window.flags.load(); });

    // Land on the pipeline page and let the kanban render from our stubbed list.
    await page.evaluate(() => window.showPage && window.showPage('pipeline'));
    await expect(page.locator('#page-pipeline')).toHaveClass(/active/, { timeout: 5000 });

    // The legacy renderKanban() path renders .pip-card with an inline onclick that
    // calls openInquiry(threadId). Wait for at least one to show up.
    const card = page.locator('.pip-card').filter({ hasText: 'Drafted Customer' }).first();
    await expect(card).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: path.join(OUT, `pipeline-${vp.name}.png`), fullPage: false });

    // Click the drafted card — this should route through openInquiry → quoteReviseOpen.
    await card.click();

    // The Quote Builder page becomes active.
    await expect(page.locator('#page-quotes')).toHaveClass(/active/, { timeout: 5000 });

    // The revision banner is the load-bearing indicator that quoteReviseOpen ran.
    // It only exists in the DOM after that function fires.
    await expect(page.locator('#qb-revision-banner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#qb-revision-banner')).toContainText('Drafted Customer');

    // Hydration assertions — these IDs are the ones the bug fix points the JS at.
    // If we regress to q-sc-pct / q-delivery-fee / q-tax-exempt the values will be
    // their default 0 / 50 / unchecked instead of 12 / 75 / false-but-set.
    await expect(page.locator('#charge-pct')).toHaveValue('12', { timeout: 3000 });
    await expect(page.locator('#delivery-fee-input')).toHaveValue('75');
    // Tax exempt was false in our stub — confirm the checkbox is unchecked
    // (i.e. the read happened against the real ID and didn't throw).
    const taxExempt = page.locator('#qb-tax-exempt-chk');
    await expect(taxExempt).toBeVisible();
    expect(await taxExempt.isChecked()).toBe(false);

    await page.screenshot({ path: path.join(OUT, `revise-modal-${vp.name}.png`), fullPage: false });
  });
}
