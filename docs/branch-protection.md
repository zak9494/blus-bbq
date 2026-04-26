# Branch protection on `main`

GitHub branch-protection rules block merges that don't pass CI and don't have an approving review. This document records what's enforced, why, and how to bypass for true emergencies.

## What's enforced

The protection ruleset on `main`:

- **Required status checks (strict)** — the PR's branch must be **up to date with main** AND every required check must be green:
  - `Playwright smoke suite` (from `.github/workflows/smoke.yml`)
  - `Vercel` (Vercel preview deploy must succeed)
- **Required reviews** — at least **1 approving review** from a user with write access (i.e. Zach).
- **No direct pushes to `main`** — every change goes through a PR. Even Zach's local changes.
- **No force-pushes** to `main`.
- **No branch deletion** — `main` cannot be deleted.
- **Conversation resolution required** — open PR review comments must be resolved before merge.
- **Admins NOT exempt** by default (`enforce_admins: false` is set, but the ruleset still applies until admin override; see "Bypass" below).

## Why these specific rules

| Rule | Class of bug it prevents |
|------|--------------------------|
| Required smoke + Vercel checks | Bad code shipped to prod because someone "merged through" a red check |
| Required 1 approval | The kind of solo-merge that drops `chore(status):` commits into a feature branch and pollutes the diff (see [`parallel-branch-contention.md` runbook](./runbooks/parallel-branch-contention.md)) |
| No direct pushes | Tracking-system / STATUS refresh tasks were pushing direct to `main` — now they must open a PR |
| No force-push | Avoids accidentally rewriting history that another open PR is rebased on |
| Strict status checks | Forces a rebase before merge, which is the only reliable way to know the merge result will be green |

## Setup (one-time)

Run from the repo root with a token that has `repo` + `admin:repo` scope:

```bash
gh api repos/zak9494/blus-bbq/branches/main/protection \
  --method PUT \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Playwright smoke suite", "Vercel"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
```

## How agents (and humans) push changes now

The CLAUDE.md "Branching Discipline" section is now load-bearing:

1. `git checkout main && git pull origin main && git checkout -b <new-branch>`
2. Edit + commit (pre-commit hook runs ESLint, Prettier, unit tests).
3. `git push -u origin <new-branch>`
4. `gh pr create` — the smoke + Vercel checks fire.
5. Wait for green CI **and** Zach's approval.
6. `gh pr merge <N> --squash` (only succeeds once both gates clear).

**Orchestrator agents (Wave Shepherd, STATUS-refresh tasks, etc.) NEVER push directly to `main` anymore.** Every change is a PR. The pre-merge screenshot review IS the approval — Zach taps "Approve" via the screenshot batch flow for STATUS.md / docs PRs.

## Verifying the protection is in place

```bash
gh api repos/zak9494/blus-bbq/branches/main/protection | jq '{
  contexts: .required_status_checks.contexts,
  strict:   .required_status_checks.strict,
  reviews:  .required_pull_request_reviews.required_approving_review_count,
  force:    .allow_force_pushes.enabled,
  delete:   .allow_deletions.enabled
}'
```

A direct push attempt should fail:

```bash
git checkout main
echo "test" >> /tmp/fake.txt
git add /tmp/fake.txt
git commit -m "should fail"
git push origin main
# remote: error: GH006: Protected branch update failed for refs/heads/main.
# remote: error: Required status check "Playwright smoke suite" is expected.
```

## Emergency bypass

If CI is genuinely broken (the smoke suite has a flake we can't fix in time) and a hotfix MUST land, an admin can:

1. **Temporarily disable the ruleset** — Settings → Branches → Edit rule → "Disable". Land the hotfix. Re-enable.
2. **Use admin override** on a single PR — repository admin can merge despite a failing required check (GitHub shows a warning prompt).
3. **Push directly with an unprotect-then-reprotect dance** — discouraged; admin override on the PR is cleaner.

After any bypass, **write a postmortem** covering: what failed, why bypass was the right call, what test would have caught the underlying issue, and what tracking issue was opened to fix the gap.

## Rolling back the protection

If the ruleset itself causes a problem (e.g. a CI context name changed and now nothing can merge), undo with:

```bash
gh api repos/zak9494/blus-bbq/branches/main/protection \
  --method DELETE
```

Then re-apply the corrected ruleset using the JSON above.

## Related runbooks

- [`pr-stuck-in-bucket.md`](./runbooks/pr-stuck-in-bucket.md) — what to do when a PR is red / awaiting review > 2h
- [`parallel-branch-contention.md`](./runbooks/parallel-branch-contention.md) — why direct pushes to main are forbidden
