# Runbook: `customer_profile_v2` flag misbehaves

## Symptoms

- Flipping `customer_profile_v2` ON causes smoke tests to red.
- Customers report they can't reach a customer profile page that previously worked.
- Direct-nav to `/customer/<email>` shows a "Failed to load" or hangs on a spinner.
- Repeat-customer badge disappears when the flag is on.

## Immediate action (T+0)

If production is broken: **flip the flag OFF** via the production flags API:

```bash
curl -X POST "https://blus-bbq.vercel.app/api/flags" \
  -H "x-inq-secret: $INQ_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"customer_profile_v2","enabled":false}'
```

The flag is gated server-side and read client-side via `window.flags.isEnabled('customer_profile_v2')` — turning it off restores v1 behavior immediately on the next page load.

## Diagnose (T+5)

```bash
# Confirm flag state
curl -s "https://blus-bbq.vercel.app/api/flags" | jq '.[] | select(.name=="customer_profile_v2")'

# Confirm the v2 endpoints respond
curl -s "https://blus-bbq.vercel.app/api/inquiries/by-email?email=test@example.com" | jq .
```

Look at the server logs for the customer-profile route (`vercel logs --since=15m | jq 'select(.route | test("customer"))'` once structured logging is wired up).

## Root cause checklist

- [ ] A KV inquiry record is missing the `customer.email` field that v2 indexes by
- [ ] The repeat-customer fetch is hitting `/api/inquiries/by-email` without a secret and getting 401
- [ ] A smoke test is asserting `flag.enabled === false` (default-OFF), which breaks the moment we flip it ON — see the `project_smoke_flag_default_off.md` memory note
- [ ] A v2 component path was missed when the v1 → v2 cutover landed (check `git log -- static/js/customer-profile*` for orphan commits)
- [ ] The notifications-page → customer-profile direct-nav handler hangs on the loading state (PR #81 fixed one variant; another may have regressed it)

## Fix

1. **Smoke-test breakage from a flag flip**: either reset the flag OFF (immediate action above) and update the test to be flag-aware, or land the test update first then flip the flag.
2. **Missing `customer.email`**: a one-shot `scripts/backfill-*.js` script may already exist (`scripts/backfill-index-phone-budget.js` is the template). Write a similar backfill, run against prod with `INQ_SECRET`.
3. **Direct-nav hang**: check `static/js/customer-profile.js` for an unguarded `await` that blocks render. Wrap with timeout + fallback empty-state, similar to the `/notifications` page pattern from PR #82.

## Verify

```bash
# Hit the prod flag endpoint and confirm the desired state
curl -s "https://blus-bbq.vercel.app/api/flags" | \
  jq '.[] | select(.name=="customer_profile_v2") | .enabled'

# Hit a known customer profile page
open "https://blus-bbq.vercel.app/customer/<known-email>"

# Re-run smoke
npx playwright test tests/smoke/ --reporter=line
```

## Post-incident

- If a smoke test broke because of the flag flip, add the flag to a "smoke knows about this flag" list and adjust the assertion (look for default-OFF assertions in `tests/smoke/`).
- If the v2 cutover missed a path, audit the rest of the v2 components for the same omission.
- Update [the project memory note on `customer_profile_v2`](../../memory/project_restore_customer_profile_v2.md) with the date and root cause.
