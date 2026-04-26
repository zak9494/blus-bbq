# Runbook: rotate a shared secret

Covers `INQ_SECRET`, `SELF_MODIFY_SECRET`, `GMAIL_READ_SECRET`, and similarly-shaped HMAC / API secrets.

## Symptoms

- Suspicion or evidence of leak (secret pushed to a public artefact, screenshot in a Slack channel, etc.).
- Vendor recommended rotation (calendar / payment provider).
- Quarterly hygiene rotation.

## Immediate action (T+0)

If the secret is **confirmed leaked** (visible in a public commit, public log, etc.):

1. Generate a new secret (`openssl rand -hex 32`).
2. Set the new value in **Vercel → Project → Settings → Environment Variables → Production**.
3. Trigger a redeploy (push an empty commit or use the dashboard "Redeploy" button).
4. **Do not** revoke the old secret yet — wait until the new deployment is live and you've verified at least one request through the new value.

If it's a routine rotation, skip to Diagnose.

## Diagnose (T+5)

```bash
# Confirm where the secret is referenced
git grep -n 'INQ_SECRET'        # or whichever secret

# Make sure no client code reads it (server-only by convention)
git grep -n 'INQ_SECRET' static/ api/  # api/ should be the only hit
```

Server-side reads should use `process.env.<NAME>` and exit early if unset. Verify nothing logs the value (`grep -n 'console.log.*SECRET' api/`).

## Root cause checklist (for leak rotations)

- [ ] Did the value end up in a commit message or PR description?
- [ ] Did a fixture file accidentally embed it?
- [ ] Did a `console.log` print it (check `vercel logs`)?
- [ ] Did a screenshot include it (check the most recent screenshot batch)?

## Fix

1. **Generate**: `openssl rand -hex 32` (256 bits).
2. **Set in Vercel** for `Production`, `Preview`, and `Development` scopes — all three. Mismatch between preview and production breaks the smoke cron.
3. **Update local `.env.local`** if you keep one. Never commit `.env*` files.
4. **Redeploy production**: empty commit or `vercel --prod` from the dashboard.
5. **Verify** (next section) before revoking the old value.
6. **Revoke**: remove the old value from Vercel only after the new value is in production and confirmed working.
7. **If leaked**: rotate any secret derived from this one (Twilio, Stripe, Gmail OAuth refresh tokens are independent — they have their own runbooks).

## Verify

```bash
# Hit the protected endpoint with the new secret
curl -X POST -H "x-inq-secret: $NEW_SECRET" \
  https://blus-bbq.vercel.app/api/inquiries/save -d '{"test":true}'

# Should return 200, not 401
```

Run the smoke suite once after rotation:

```bash
npx playwright test tests/smoke/ --reporter=line
```

If smoke tests assert `flag.enabled === false` and rely on `INQ_SECRET` for KV writes, they'll fail noisily if the new secret didn't propagate.

## Post-incident

- **If the rotation was triggered by a leak**: write a postmortem covering how the secret escaped, what monitoring would have caught it sooner, and any process change needed.
- Add a `git secrets`-style pre-commit grep for the leaked pattern (best-effort — not a substitute for real secret scanning).
- Document the rotation date in `STATUS.md` "Discussed, not queued" or in a private rotation log.
