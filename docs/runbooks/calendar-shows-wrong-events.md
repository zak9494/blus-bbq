# Runbook: Calendar shows wrong / missing events

## Symptoms

- An inquiry exists in the pipeline but doesn't appear on the Calendar page.
- The calendar shows events for dates the user didn't book.
- Day / Week / Month view counts disagree.
- A Google-Calendar push notification arrived but the page didn't refresh.

## Immediate action (T+0)

If a customer-facing surface (anywhere shown to customers) is broken, fall back to the Pipeline page — the inquiry data there is canonical regardless of the calendar render. Tell the user "use the pipeline page for now".

Otherwise, skip to Diagnose.

## Diagnose (T+5)

```bash
# 1. Confirm the inquiry exists in KV
curl -s "https://blus-bbq.vercel.app/api/inquiries/list" | \
  jq '.inquiries[] | select(.thread_id=="<thread>")'

# 2. Confirm the inquiry has an event_date the calendar would index
#    (calendar v2 reads event_date from the KV inquiry; missing date = no render)
curl -s "https://blus-bbq.vercel.app/api/inquiries/get?thread_id=<thread>" | \
  jq '{event_date, status, source}'

# 3. Confirm the Google Calendar list endpoint returns the event for that month
curl -s "https://blus-bbq.vercel.app/api/calendar/list?year=2026&month=4" | \
  jq '.events[] | select(.summary | test("<customer-name>"))'

# 4. Confirm calendar:syncToken is fresh (stale token = stale events)
#    There's no public endpoint for this — read via Vercel logs
#    or the watch-status endpoint:
curl -s "https://blus-bbq.vercel.app/api/calendar/watch-status" | jq .
```

## Root cause checklist

- [ ] Inquiry KV record is missing `event_date` (calendar v2 fix in PR #83 added this index)
- [ ] `calendar:syncToken` is stale and `pendingRefresh` is set but no consumer ran
- [ ] Watch channel expired (`expiration` < now); `api/cron/renew-calendar-watch.js` should auto-renew daily at 5 AM CT — check the last run
- [ ] Filter mismatch: a status filter (Lost, Archived) is hiding the event in the UI
- [ ] Day / Week / Month view discrepancy: the date math wraps a TZ boundary differently in the three views (Chicago TZ is the default)
- [ ] The customer's calendar event was created before `api/calendar/list.js` started reading from KV (PR #64 cutover)

## Fix

1. **Missing `event_date`**: write a one-shot KV migration. Look at `scripts/backfill-index-phone-budget.js` as a template.
2. **Stale sync token**: trigger a refresh by hitting the watch-register endpoint, or DELETE `calendar:syncToken` from KV with `INQ_SECRET` and let the next list call do a full sync.
3. **Expired watch channel**: re-run `api/cron/renew-calendar-watch.js` once manually, then look at why the daily cron didn't fire.
4. **Filter hiding**: clear the filter chip on `/calendar` and reproduce. If the filter is sticky in localStorage, clear with `localStorage.removeItem('cal-filter-state')` in the browser.
5. **TZ boundary**: confirm with a fixture that the event's `start.dateTime` ISO string sits on the same Chicago day as expected; fix in `static/js/calendar.js`'s view-renderer.

## Verify

```bash
# Reload the calendar page, check the day / week / month view all show the event
open "https://blus-bbq.vercel.app/calendar"

# Re-run smoke
npx playwright test tests/smoke/calendar.spec.js --reporter=line
```

## Post-incident

- If a sync-token / watch-channel issue caused this, add a Sentry breadcrumb or a `vercel logs`-readable warning when the token gets stale (PR with structured logging makes this trivial).
- If the bug reproduces, add a Playwright regression spec under `tests/audit/` covering the exact scenario.
- The calendar v2 series (PRs #64, #83) is recent — keep an eye on the same class of failure for the next two weeks.
