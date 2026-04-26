# Runbook: Wave Shepherd GitHub Action

## Symptoms

- The `wave-shepherd.yml` workflow run is red, or the daily `wave-shepherd alert` GitHub issue stops appearing despite stalled PRs.
- Open PRs that should auto-merge (CLEAN + green + `auto-merge-ok` label) sit unmerged for >30 min.
- Manual `gh workflow run wave-shepherd.yml` returns non-zero.

## Immediate action

If the workflow is failing in a way that risks accidental merges, disable it: `gh workflow disable wave-shepherd.yml`. Otherwise leave it running while you diagnose — a stalled shepherd is a no-op, not destructive.

## Diagnose

1. `gh run list --workflow=wave-shepherd.yml --limit 5` — find the most recent runs.
2. `gh run view <run-id> --log-failed` — read the failure.
3. Check whether the failure is in classification (`gh pr list`/`gh pr view` calls) or in action (`gh pr merge`, `gh pr comment`).
4. Manual repro: `gh workflow run wave-shepherd.yml -f dry_run=1` and watch the resulting summary artifact.

## Root cause checklist

- GitHub token expired or scope reduced (look for 401/403 in the log).
- `jq`/`bash` syntax regression in `scripts/wave-shepherd.sh` (the script targets bash 3 for macOS dev parity).
- A labelled-but-DIRTY PR triggering a merge attempt and crashing on conflict.
- Workflow concurrency limit hit (rare; check the run queue).

## Fix

- Token issues: rotate `GITHUB_TOKEN` permissions or fall back to a fine-grained PAT in repo secrets.
- Script regressions: revert the offending commit on `scripts/wave-shepherd.sh` and patch forward in a new commit.
- Conflict crashes: guard `gh pr merge` with the `mergeStateStatus=CLEAN` check before invoking.

## Verify

- Trigger a dry run: `gh workflow run wave-shepherd.yml -f dry_run=1`.
- Confirm a non-empty summary artifact uploads and the step log echoes the same content.
- Re-enable the workflow if previously disabled: `gh workflow enable wave-shepherd.yml`.

## Post-incident

- File a follow-up issue if the root cause was a script regression — add a regression test in `scripts/` so future bash/jq drift fails CI before it reaches the cron.
- If a token had to be rotated, update the rotation date in `docs/runbooks/secret-rotation.md`.

---

## Reference: how it works

The Wave Shepherd is a PR-triage cron that used to run on Zach's laptop via
local Claude scheduled tasks. It now runs on GitHub Actions:

- Workflow: [`.github/workflows/wave-shepherd.yml`](../../.github/workflows/wave-shepherd.yml)
- Script:   [`scripts/wave-shepherd.sh`](../../scripts/wave-shepherd.sh)
- Schedule: `*/30 * * * *` (every 30 min) + `workflow_dispatch`

## What it does each run

1. Fetches the first 50 open PRs in `${{ github.repository }}`.
2. Classifies each PR:

   | Bucket | Trigger | Action |
   |---|---|---|
   | **Auto-merged** | `mergeStateStatus=CLEAN`, all checks green, label `auto-merge-ok` present | `gh pr merge --squash --delete-branch` |
   | **CLEAN + green** | Same as above, no `auto-merge-ok` label | No-op (waits for human merge) |
   | **CI failing <1h** | At least one failed check, most recent failure <60 min old | No-op (give it time) |
   | **CI failing >1h** | Same, but oldest failure >60 min | Comments on PR + `gh run rerun --failed` once |
   | **DIRTY** | `mergeStateStatus=DIRTY` (merge conflicts) | Comments "needs rebase" |
   | **Abandoned** | `updatedAt > 4 days ago` AND failing checks | Comments "stalled, close if dead". **Never auto-closes.** |
   | **Drafts** | `isDraft=true` | Skipped entirely |

3. Writes a summary file (`shepherd-summary-<UTC-timestamp>.md`) and uploads it
   as a workflow artifact (14-day retention). The same summary is echoed to the
   step log.
4. If anything has been stalled >2h, the script opens (or appends a comment to)
   a daily issue titled `wave-shepherd alert: YYYY-MM-DD`, labeled
   `wave-shepherd`. One issue per day; subsequent runs append.

## Manual trigger

```bash
gh workflow run wave-shepherd.yml --repo zak9494/blus-bbq
# Dry run (no comments, no merges, no issue creation):
gh workflow run wave-shepherd.yml --repo zak9494/blus-bbq -f dry_run=1
```

Watch:

```bash
gh run list --repo zak9494/blus-bbq --workflow wave-shepherd.yml --limit 5
gh run view <run-id> --repo zak9494/blus-bbq --log
```

## Reading the artifact

Each run uploads `shepherd-summary-<run_id>` containing a single markdown file.
Download:

```bash
gh run download <run-id> --repo zak9494/blus-bbq --name shepherd-summary-<run-id>
```

The summary lists every PR per bucket so you can scan what was acted on. The
"Stalled >2h" line at the bottom matches what (if anything) was posted to the
daily alert issue.

## Auto-merge control valve

Auto-merge is **opt-in per PR** via the `auto-merge-ok` label. To enable:

```bash
gh pr edit <number> --repo zak9494/blus-bbq --add-label auto-merge-ok
```

The shepherd will only squash-merge if **all** are true:
- `mergeStateStatus=CLEAN` (no conflicts, branch protections satisfied)
- Every check completed with success (no pending, no failures)
- Label `auto-merge-ok` is set

Remove the label to revoke; the shepherd re-evaluates on the next 30-min tick.

## Debugging failures

If a workflow run fails:

1. Open `gh run view <id> --log` and find the `Run wave-shepherd` step.
2. Common causes:
   - **`gh: command not found`** — shouldn't happen; `gh` ships pre-installed
     on `ubuntu-latest` runners.
   - **`HTTP 403` on `gh issue create` / `pr comment`** — the workflow's
     `permissions:` block is wrong. Should be `pull-requests: write` and
     `issues: write`.
   - **`HTTP 404` on `gh run rerun`** — the most recent run for the branch was
     pruned or doesn't exist. Non-fatal; the script logs `WARN` and moves on.
   - **`jq: error: Cannot iterate over null`** — `statusCheckRollup` was null.
     The script defaults to `[]` but a malformed PR record (rare) can slip
     through. Open an issue with the failing run ID.
3. To reproduce locally with no side effects:
   ```bash
   cd /Users/zach/Documents/blus-bbq
   DRY_RUN=1 REPO=zak9494/blus-bbq bash scripts/wave-shepherd.sh
   ```
   Requires `gh` authenticated (`gh auth login`) and `jq`.

## Migration status

- **2026-04-26:** Workflow landed. Local
  `blus-bbq-wave-shepherd` scheduled task remains the source of truth.
- **+24h verification:** Compare the GH Actions runs against what the local
  shepherd flagged. Same PRs in the same buckets → migration confirmed.
- **After verification:** Disable the local scheduled task via Dispatch. Keep
  the local cron file checked in / toggle-able as a fallback.

## Two later cron migrations (separate PRs)

This PR migrates only the Wave Shepherd. Two more local crons follow,
each in its own PR:

1. **Post-merge prod smoke** (currently `*/10 * * * *` on Zach's laptop)
2. **Hourly STATUS dashboard refresh**

Do not bundle them with this one.
