# Runbook: `/notifications` page broken

## Symptoms

- `/notifications` shows "Failed to load" instead of an empty-state or list.
- Page renders with two hamburger menus (header + duplicated module).
- VAPID `pushManager.subscribe` fails on iPhone with `VapidPkHashMismatch`.
- Settings SAVE returns 401 even though `/api/auth/status` says connected.
- Notification counts in the badge don't match what the panel renders.

## Immediate action (T+0)

If push notifications aren't reaching anyone (silent degradation), no T+0 action is needed — diagnose first. The page is non-critical for prod use.

If the page itself crashes the browser tab, **flip `notifications_center` flag OFF** so we fall back to the basic notification UI:

```bash
curl -X POST "https://blus-bbq.vercel.app/api/flags" \
  -H "x-inq-secret: $INQ_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"notifications_center","enabled":false}'
```

## Diagnose (T+5)

```bash
# Is VAPID key endpoint healthy?
curl -sI "https://blus-bbq.vercel.app/api/notifications/vapid-key"
# Cache-Control MUST be "no-store" (load-bearing invariant — see CLAUDE.md)

curl -s "https://blus-bbq.vercel.app/api/notifications/vapid-key" | jq .

# Are subscriptions in KV?
curl -s -H "x-inq-secret: $INQ_SECRET" \
  "https://blus-bbq.vercel.app/api/notifications/subscribe" | jq '. | length'

# Counts endpoint healthy?
curl -s "https://blus-bbq.vercel.app/api/notifications/counts" | jq .

# Open the page and read the network tab manually
open "https://blus-bbq.vercel.app/notifications"
```

For VAPID hash-mismatch on iPhone specifically: confirm `Cache-Control: no-store` on the response. If anything cached the public key, iOS keeps the old one and rejects the new subscription.

## Root cause checklist

- [ ] `Cache-Control: no-store` regression on `/api/notifications/vapid-key` — load-bearing per the 2026-04-20 incident, do not introduce caching here
- [ ] Client `fetch('/api/notifications/vapid-key')` lost its `{ cache: 'no-store' }` option
- [ ] Duplicate hamburger from PR #87 / #77 area — `static/js/notifications.js` injected its own header instead of reusing `<aside.sidebar>`
- [ ] Settings SAVE 401 — endpoint requires `INQ_SECRET` but the client isn't passing it (hotfix in PR #77)
- [ ] Empty-state regression — `/api/notifications/counts` returning `null` triggers "Failed to load" instead of zeros (hotfix in PR #82)
- [ ] Push subscription is stale (410 Gone from FCM); `api/notifications/send.js` should auto-clear; if it doesn't, `subscribe.js` accumulates dead entries

## Fix

1. **`Cache-Control` regression**: re-add `res.setHeader('Cache-Control', 'no-store')` in `api/notifications/vapid-key.js`. Add a Playwright assertion that hits the endpoint and asserts the header.
2. **Duplicate hamburger**: PR #87 fix-pattern — `notifications.js` should not call any `injectHamburger()`-style helper; the global header in `<aside.sidebar>` is canonical.
3. **Settings 401**: confirm the client send-path includes the `x-inq-secret` header — PR #85 added a regression test, run it.
4. **Empty-state**: `static/js/notifications-panel.js` should treat `null` and `[]` identically as "no notifications, render zero state". Reproduce with `counts.test.js`.
5. **Stale subscriptions**: confirm `api/notifications/send.js` removes the subscription on a 410 response — the unit test `api/notifications/send.test.js` covers this.

## Verify

```bash
# All four endpoints respond as expected
curl -sI "https://blus-bbq.vercel.app/api/notifications/vapid-key" | grep -i cache-control
curl -s "https://blus-bbq.vercel.app/api/notifications/counts" | jq .
curl -s "https://blus-bbq.vercel.app/api/notifications/vapid-key" | jq .

# Page loads and shows either notifications or empty-state (never "Failed to load")
npx playwright test tests/smoke/notifications.spec.js --reporter=line
```

## Post-incident

- If `Cache-Control` regressed, the Playwright test should have caught it — add the assertion if missing.
- If duplicate hamburger reappeared, `scripts/check-hamburger.js` should be wired into smoke (already exists in `scripts/`, may not be CI-wired yet).
- Memory rule: the notifications page is fragile — when touching `static/js/notifications*.js` or `api/notifications/*.js`, run `npx playwright test tests/smoke/notifications.spec.js` before pushing.
