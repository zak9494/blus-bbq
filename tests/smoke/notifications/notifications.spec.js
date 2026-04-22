// @ts-check
// Notifications API smoke tests.
// Flag-off tests always run. Flag-on tests require SMOKE_SECRET env var and
// temporarily enable notifications_center, then restore it to off in teardown.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://blus-bbq.vercel.app';
const SECRET   = process.env.SMOKE_SECRET   || '';
const FLAGS_URL = BASE_URL + '/api/flags/notifications_center';
const FLAG_SECRET = 'c857eb539774b63cf0b0a09303adc78d';

// Ensure flag is off before flag-off assertions (guards against stale dev KV state)
test.beforeAll(async ({ request }) => {
  await request.post(FLAGS_URL, {
    data: { secret: FLAG_SECRET, enabled: false },
  }).catch(() => {});
});

// ── flag-off (always run, no auth needed) ─────────────────────────────────────

test('GET /api/notifications returns 404 when flag is off', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/notifications');
  expect(res.status()).toBe(404);
});

test('GET /api/notifications/types returns 404 when flag is off', async ({ request }) => {
  const res = await request.get(BASE_URL + '/api/notifications/types');
  expect(res.status()).toBe(404);
});

test('POST /api/notifications/mark-all-read returns 404 when flag is off', async ({ request }) => {
  const res = await request.post(BASE_URL + '/api/notifications/mark-all-read');
  expect(res.status()).toBe(404);
});

// ── flag-on (requires SMOKE_SECRET) ──────────────────────────────────────────

test.describe('flag-on tests', () => {
  test.skip(!SECRET, 'Skipped: SMOKE_SECRET not set');

  test.afterAll(async ({ request }) => {
    // Always restore flag to off
    await request.post(FLAGS_URL, {
      data: { secret: SECRET, enabled: false },
    });
  });

  test('enable flag and GET /api/notifications returns 200 with expected shape', async ({ request }) => {
    // Enable flag
    const flagRes = await request.post(FLAGS_URL, {
      data: { secret: SECRET, enabled: true },
    });
    expect(flagRes.status()).toBe(200);

    // GET list
    const res  = await request.get(BASE_URL + '/api/notifications');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.unread_count).toBe('number');
  });

  test('GET /api/notifications/types returns 200 with all 7 seed types', async ({ request }) => {
    const res  = await request.get(BASE_URL + '/api/notifications/types');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);
    expect(Array.isArray(body.types)).toBe(true);
    expect(body.types.length).toBeGreaterThanOrEqual(7);
    const ids = body.types.map((t) => t.id);
    for (const expected of [
      'follow_up_due', 'deposit_overdue', 'customer_reply',
      'quote_sent', 'event_tomorrow', 'event_today', 'inquiry_needs_review',
    ]) {
      expect(ids).toContain(expected);
    }
  });

  test('POST /api/notifications creates a notification and GET returns it', async ({ request }) => {
    const createRes = await request.post(BASE_URL + '/api/notifications', {
      data: {
        secret:   SECRET,
        type:     'inquiry_needs_review',
        title:    'Smoke test notification',
        body:     'Created by smoke test',
        severity: 'low',
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created).toHaveProperty('ok', true);
    const notif = created.notification;
    expect(notif).toHaveProperty('id');
    expect(notif.type).toBe('inquiry_needs_review');
    expect(notif.read).toBe(false);

    // Fetch it back
    const getRes = await request.get(BASE_URL + '/api/notifications/' + notif.id);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.notification.id).toBe(notif.id);

    // Mark read
    const patchRes = await request.patch(BASE_URL + '/api/notifications/' + notif.id, {
      data: { action: 'read' },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).notification.read).toBe(true);

    // Delete
    const delRes = await request.delete(BASE_URL + '/api/notifications/' + notif.id, {
      data: { secret: SECRET },
    });
    expect(delRes.status()).toBe(200);
    expect((await delRes.json()).deleted).toBe(true);
  });

  test('POST /api/notifications/mark-all-read returns 200', async ({ request }) => {
    const res  = await request.post(BASE_URL + '/api/notifications/mark-all-read');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);
    expect(typeof body.updated).toBe('number');
  });
});
