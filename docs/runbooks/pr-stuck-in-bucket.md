# Runbook: PR has been red / stalled for >2h

## Symptoms

- `gh pr list --state open --json number,createdAt,statusCheckRollup` shows a PR with red checks older than 2 hours.
- Wave Shepherd cron flags the PR as "needs Zach review" or "stalled".
- A draft / not-yet-ready PR sits with no commits for hours.

## Immediate action (T+0)

If this is a hotfix branch (commit message prefix `hotfix(`), escalate immediately — push notification or Slack mention. Hotfixes don't sit.

If this is a normal `feat(` / `fix(` PR, skip to Diagnose.

## Diagnose (T+5)

```bash
# What's the status?
gh pr view <N> --json title,statusCheckRollup,reviews,mergeable

# Which check is failing?
gh pr checks <N>

# Get the most recent failed CI log
RUN_ID=$(gh run list --branch <pr-branch> --status failure --limit 1 --json databaseId -q '.[0].databaseId')
gh run view "$RUN_ID" --log-failed | head -200
```

Common signatures:

| Signature                                                  | Likely cause                                  |
|------------------------------------------------------------|-----------------------------------------------|
| Single Playwright spec failed; passed on rerun in another PR | Flake — rerun once before treating as real |
| `Vercel … failed`                                          | See `vercel-deploy-failed.md`                 |
| `npm test … fail`                                           | Real unit-test regression                     |
| `lint-staged failed` in commit-msg                         | Pre-commit didn't run locally                 |
| `0 reviews` and `mergeable: true`, > 2h since opened       | Waiting on Zach approval                      |

## Root cause checklist

- [ ] Real test regression — fix and push another commit
- [ ] CI flake — `gh run rerun <id>` once; if still red, treat as real
- [ ] Vercel preview env vars missing — see `vercel-deploy-failed.md`
- [ ] PR is missing a required reviewer (PR 2: branch protection)
- [ ] Author is blocked on an unrelated task and forgot the PR exists
- [ ] PR depends on another unmerged PR (look for "depends on #X" in the body)

## Fix

1. **Real regression**: fix locally, push, watch CI go green.
2. **Flake**: `gh run rerun <id>` once. If green, leave a comment noting the flake; if it's a recurring flake, file a `test(audit):` follow-up.
3. **Awaiting review**: bump in `STATUS.md` "Need your call" so Zach's next refresh picks it up. Don't merge without approval once branch protection is on.
4. **Dependency-on-PR**: if the dep merges, rebase: `git checkout <pr-branch> && git rebase origin/main && git push --force-with-lease`.
5. **Stale draft**: if author is unreachable for 24h, close the PR with a `Replaced by #<new>` if a fresher version exists, or leave it open with a comment.

## Verify

```bash
gh pr checks <N>          # all green
gh pr view <N> --json mergeable | jq .mergeable   # MERGEABLE
```

## Post-incident

- If the PR sat because Zach didn't see it: update Wave Shepherd's "needs review" surface to fire louder.
- If a flake recurred: add a retry in the Playwright config or stabilize the selector.
- If the dep chain bit us: add the chain to the PR description template ("Depends on: #X").
