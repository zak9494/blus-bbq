/**
 * Journey test — email_thread_v2 bidirectional rendering regression.
 *
 * Background: on 2026-04-25 Zach reported the iMessage-style thread view was
 * showing only outbound bubbles for the Amy thread. Root cause was
 * api/inquiries/thread.js getBodyText() returning "" for HTML-only Gmail
 * messages (Apple Mail, Outlook), so the inbound bubble rendered visually empty
 * and looked missing.
 *
 * This spec asserts: for any thread that has both an inbound and outbound
 * message, BOTH directions actually render in the DOM with non-empty content,
 * across iPhone / iPad / desktop viewports.
 *
 * The spec drives the API directly (not the inquiry list UI) so it works on a
 * fresh preview deploy without needing a specific inquiry to exist in the cards.
 */
const { test, expect, request: apiRequest } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || process.env.BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.INQ_SECRET || 'c857eb539774b63cf0b0a09303adc78d';

const VIEWPORTS = [
  { name: 'iphone',  width: 375,  height: 812  },
  { name: 'ipad',    width: 768,  height: 1024 },
  { name: 'desktop', width: 1280, height: 900  },
];

async function setFlag(request, name, enabled) {
  await request.post(BASE_URL + '/api/flags/' + name, {
    data: { secret: SECRET, enabled, description: '' },
  });
}

// Find a real inquiry whose Gmail thread contains both an inbound and outbound
// message. Returns null when none exists (spec then skips, rather than failing
// on a fresh environment).
async function findBidirectionalThread() {
  const ctx = await apiRequest.newContext();
  try {
    const list = await ctx.get(BASE_URL + '/api/inquiries/list?secret=' + encodeURIComponent(SECRET));
    if (!list.ok()) return null;
    const { inquiries } = await list.json();
    if (!Array.isArray(inquiries)) return null;

    // Real Gmail thread IDs only — skip seeded test rows whose threadId is "test-…"
    // because the thread API can't fetch them from Gmail.
    const candidates = inquiries.filter(i => i.threadId && !i.threadId.startsWith('test-')).slice(0, 25);

    for (const inq of candidates) {
      const r = await ctx.get(BASE_URL + '/api/inquiries/thread?threadId='
        + encodeURIComponent(inq.threadId) + '&secret=' + encodeURIComponent(SECRET));
      if (!r.ok()) continue;
      const data = await r.json().catch(() => null);
      const msgs = data && data.messages;
      if (!Array.isArray(msgs) || msgs.length < 2) continue;
      const hasInbound  = msgs.some(m => m.direction === 'inbound');
      const hasOutbound = msgs.some(m => m.direction === 'outbound');
      if (hasInbound && hasOutbound) return { inquiry: inq, messages: msgs };
    }
    return null;
  } finally {
    await ctx.dispose();
  }
}

test.describe('email_thread_v2 — bidirectional rendering', () => {
  test.beforeAll(async ({ request }) => {
    await setFlag(request, 'email_thread_v2', true);
  });

  test.afterAll(async ({ request }) => {
    await setFlag(request, 'email_thread_v2', false);
  });

  test('API returns at least one inbound + at least one outbound when a real thread has both', async () => {
    const found = await findBidirectionalThread();
    test.skip(!found, 'No bidirectional thread available on this deploy');

    const inboundMsgs  = found.messages.filter(m => m.direction === 'inbound');
    const outboundMsgs = found.messages.filter(m => m.direction === 'outbound');
    expect(inboundMsgs.length).toBeGreaterThanOrEqual(1);
    expect(outboundMsgs.length).toBeGreaterThanOrEqual(1);

    // Regression: every inbound must have a non-empty body. The pre-fix
    // getBodyText returned "" for HTML-only Apple Mail messages, which is what
    // Zach saw on the Amy thread. An empty body means the bubble renders empty,
    // making inbound look "missing."
    for (const m of inboundMsgs) {
      expect(m.body, 'inbound body must not be empty for ' + m.id).toBeTruthy();
      expect(m.body.length).toBeGreaterThan(0);
    }
  });

  for (const vp of VIEWPORTS) {
    test('@' + vp.name + ' both inbound and outbound bubbles render with content', async ({ page }) => {
      const found = await findBidirectionalThread();
      test.skip(!found, 'No bidirectional thread available on this deploy');

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE_URL + '/#inquiries', { waitUntil: 'networkidle' });

      // Drive the thread view directly with the known inquiry — much more
      // reliable than navigating the cards UI from three viewports.
      await page.evaluate(({ inq, secret }) => {
        window.INQ_SECRET = secret;
        const host = document.createElement('div');
        host.id = 'tv-bidirectional-host';
        host.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99999;overflow:auto';
        document.body.appendChild(host);
        return window.threadView && window.threadView.init('tv-bidirectional-host', inq);
      }, { inq: found.inquiry, secret: SECRET });

      // Wait for loading to clear
      await page.waitForFunction(
        () => !document.querySelector('#tv-bidirectional-host .tv-loading'),
        { timeout: 12000 }
      );

      const inboundBubbles  = page.locator('#tv-bidirectional-host .tv-bubble.inbound');
      const outboundBubbles = page.locator('#tv-bidirectional-host .tv-bubble.outbound');

      // Direction-class regression — both must render at least once.
      await expect(inboundBubbles.first()).toBeVisible({ timeout: 5000 });
      await expect(outboundBubbles.first()).toBeVisible({ timeout: 5000 });

      const inCount  = await inboundBubbles.count();
      const outCount = await outboundBubbles.count();
      expect(inCount + outCount).toBeGreaterThanOrEqual(2);

      // Bubble text regression — at least one inbound bubble must carry visible
      // content. Empty bubbles are exactly what Zach perceived as "missing."
      const firstInboundText = (await inboundBubbles.first().innerText()).trim();
      expect(firstInboundText.length, 'first inbound bubble must have visible text').toBeGreaterThan(0);
    });
  }
});
