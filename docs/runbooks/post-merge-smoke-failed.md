# Runbook: post-merge prod smoke failed

## Symptoms

- Push notification fires from the `post-merge-smoke` cron (`api/cron/post-merge-smoke.js` once activated, or the GH Actions equivalent in `.github/workflows/smoke.yml`).
- A red ❌ in `STATUS.md` "Last 24 hours" tagged with the failed test.
- `tests/audit/post-merge-smoke-output/` contains a fresh failure trace.

## Immediate action (T+0)

If the failed test indicates a user-visible regression on `https://blus-bbq.vercel.app/`, **stop new merges to main** and open a hotfix branch off the last green commit. Otherwise, skip to Diagnose.

## Diagnose (T+5)

```bash
# Which commit was prod on when the cron fired?
gh run list --workflow=smoke.yml --limit=5

# Open the failed run and download the trace
gh run view <run-id> --log-failed | head -200

# Reproduce locally against the same prod URL
npx playwright test tests/audit/post-merge-smoke.spec.js \
  --reporter=line --project=chromium

# If the failure is test-only (selector drift, network flake), confirm with a curl
curl -s https://blus-bbq.vercel.app/ | grep -c '<some marker>'
```

Look at the `vercel logs` for the failing route — pipe through `jq 'select(.level=="error")'` once the structured logger PR is merged.

## Root cause checklist

- [ ] Real prod regression introduced by the most recent merge (revert candidate)
- [ ] A KV flag was flipped (e.g. `customer_profile_v2`) that changes default-OFF assertions in the smoke spec
- [ ] Vercel preview env vars drifted from production (`INQ_SECRET`, `KV_REST_API_URL`, etc.)
- [ ] Selector drift — test uses a CSS class that was renamed
- [ ] Network flake — the run passes on retry without code change

## Fix

1. **If revert is correct**: `git revert <bad-commit>` on `main`, push, wait for the smoke cron to re-fire green.
2. **If KV flag flipped accidentally**: reset via the `INQ_SECRET` playbook in `CLAUDE.md` — `curl -X POST .../api/flags -d '{"name":"<flag>", "enabled":false}'`.
3. **If selector drift**: update the test, open a `test(audit):` PR, do not merge until it passes against prod.
4. **If network flake**: kick the workflow with `gh run rerun <id>` once. If it still fails, treat as a real failure.

## Verify

```bash
# Re-run the smoke against prod
gh workflow run smoke.yml --ref main

# Watch until green
gh run list --workflow=smoke.yml --limit=1
```

Confirm `STATUS.md` "Last 24 hours" reflects the resolution on the next refresh.

## Post-incident

- Add a more specific assertion to `tests/audit/post-merge-smoke.spec.js` if this failure mode wasn't already covered.
- If a flag flip was the root cause, add the flag to the smoke test's reset list.
- Postmortem only if the bad code reached prod — selector drift / flakes don't need one.
