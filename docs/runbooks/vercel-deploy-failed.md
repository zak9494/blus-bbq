# Runbook: Vercel deploy failed

## Symptoms

- Red ✘ next to the deployment row in the Vercel dashboard.
- `gh pr checks <N>` shows the Vercel check failing.
- A user reports `blus-bbq.vercel.app/` hasn't reflected a merged change.
- An API route returns 500 with a generic Vercel error page.

## Immediate action (T+0)

If production is broken (the previous deployment was rolled back automatically by Vercel, but a route is 500-ing or the home page is broken), **roll back manually** in the Vercel dashboard → Deployments → the last green deploy → "Promote to Production".

Otherwise, skip to Diagnose — Vercel only promotes on green builds, so a failed PR deploy doesn't affect prod.

## Diagnose (T+5)

```bash
# Get the PR's preview deployment URL and status
gh pr view <N> --json statusCheckRollup | \
  jq '.statusCheckRollup[] | select(.name | test("Vercel"))'

# Open the build log in the browser
open "$(gh pr view <N> --json statusCheckRollup | \
  jq -r '.statusCheckRollup[] | select(.name | test("Vercel")) | .targetUrl')"
```

Common log signatures:

| Signature                                                           | Likely cause                       |
|---------------------------------------------------------------------|------------------------------------|
| `Module not found: Error: Can't resolve …`                          | Missing `npm install` import path  |
| `Function payload size … exceeds maximum`                           | Too many `import` chains in handler|
| `Environment Variable "X" is referenced but not set`                | Missing prod env var               |
| `error TS… cannot find module`                                      | TS path drift (rare here, JS only) |
| `EROFS: read-only file system, mkdir`                               | Code wrote to disk at runtime      |
| `Unsupported Node.js version …`                                     | `engines` mismatch in package.json |

## Root cause checklist

- [ ] New `require()` of a path that doesn't exist on the deployed file tree
- [ ] Env var added in code but not in Vercel dashboard (Project → Settings → Environment Variables)
- [ ] Cron handler crashed at module-load time (Vercel imports it during build)
- [ ] `vercel.json` rewrites added an entry pointing to a non-existent file
- [ ] Bundle exploded past the 50 MB function limit

## Fix

1. Reproduce locally: `node -e "require('./api/<path>.js')"` for a quick module-load smoke.
2. For env-var failures: add the var in Vercel dashboard, then `gh pr comment <N> --body "/redeploy"` or push an empty commit to retrigger.
3. For path drift: fix the require, push a new commit on the same branch.
4. For cron crashes: wrap the offender in `try/catch`, log via `lib/logger.js`, and let the next invocation succeed.
5. For bundle bloat: split the route into per-endpoint files instead of one mega-handler.

## Verify

```bash
# Watch the deploy
gh pr checks <N> --watch

# Hit the route once green
curl -s https://blus-bbq.vercel.app/api/<route> | jq .
```

## Post-incident

- If env-var drift caused this, update the deployment checklist in the PR description template (or add it).
- If a cron crashed, add a Sentry breadcrumb (PR with Sentry wiring) so the next crash pages instead of silently failing.
