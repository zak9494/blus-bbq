# Sentry setup — Zach's checklist

This PR ships the Sentry wiring **flag-OFF and DSN-unset**, so it's a clean no-op until you complete the steps below. Until you flip the flag ON, no requests go to Sentry, no client bundle is loaded, and `/api/sentry-config` returns `{ enabled: false }`.

## 1. Create a Sentry project

1. Sign in at https://sentry.io (free tier covers the volume we'll see).
2. Create a project — pick the **Browser JavaScript** platform; Sentry will create a unified DSN that works for both browser and Node.
3. Copy the **DSN** from Project Settings → Client Keys (DSN). It looks like `https://<hash>@oNNN.ingest.sentry.io/<id>`.

The DSN is safe to expose publicly — it's a write-only token tied to one project.

## 2. Add the DSN to Vercel

1. Vercel dashboard → Project `blus-bbq` → Settings → Environment Variables.
2. Add `SENTRY_DSN` with the value from step 1, scoped to **Production**, **Preview**, AND **Development**.
3. Trigger a redeploy (push an empty commit, or "Redeploy" on the latest deployment). Vercel injects new env vars only on the next build.

## 3. Flip the `sentry_enabled` flag ON

```bash
curl -X POST "https://blus-bbq.vercel.app/api/flags" \
  -H "x-inq-secret: $INQ_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"sentry_enabled","enabled":true}'
```

Or use the AI dashboard's flag UI.

## 4. Verify

```bash
# Should return enabled:true with the DSN echoed
curl -s https://blus-bbq.vercel.app/api/sentry-config | jq .
```

Then trigger a deliberate error in a non-prod-impacting endpoint and confirm it appears in the Sentry dashboard within ~30 seconds. A simple way:

```bash
curl -s https://blus-bbq.vercel.app/api/_diag/throw   # if you keep a diag endpoint
```

Or deliberately break a click handler in DevTools and check that the unhandled error shows up.

## 5. Wire into the STATUS dashboard

Once Sentry is producing data, the hourly STATUS cron should fetch unresolved errors from the last 24 hours and prepend them to `STATUS.md` under a new section `🔴 Sentry errors (last 24h)`. The query is roughly:

```
GET https://sentry.io/api/0/projects/<org>/<proj>/issues/?query=is:unresolved+age:-24h&statsPeriod=24h
Authorization: Bearer <SENTRY_AUTH_TOKEN>
```

`SENTRY_AUTH_TOKEN` is a separate token (User Settings → API Tokens) with scopes `event:read` and `project:read`. Add it to the cron's env vars only — never to client-side env or to the public Vercel env scope.

The Wave Shepherd cron should treat any Sentry error count > 0 as a stalled item and auto-spawn a hotfix task with a link to the Sentry issue.

## 6. Adversarial verification rule

When an agent claims a bug is fixed, the verification spawn must **also check Sentry** for the same error signature in the last 24 hours. A test passing locally is necessary but not sufficient — Sentry confirms the fix landed in production traffic.

## Rollback

If Sentry causes any issue (rate limits, performance regression, etc.):

```bash
# Flag flip — instant
curl -X POST "https://blus-bbq.vercel.app/api/flags" \
  -H "x-inq-secret: $INQ_SECRET" \
  -d '{"name":"sentry_enabled","enabled":false}'
```

The client init is a soft-fail by design — turning the flag off stops new error capture immediately on the next page load. No code change or redeploy needed.
