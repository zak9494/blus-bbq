# Runbook: Post-restart recovery

> When the user's machine restarts (manual reboot, OOM crash, Claude Code session killed), in-flight work scattered across worktrees, local-only commits, and paused crons needs to be re-converged. This runbook turns a 30-minute manual orchestration into a single inventory command + a 2-3 minute review of recommended actions.

---

## Symptoms

Any of the following indicates a restart event has invalidated in-flight task state:

- Computer was rebooted (planned, kernel panic, power loss).
- An autonomous Claude Code session was killed (OOM, force-quit, terminal closed).
- `mcp__scheduled-tasks__list_scheduled_tasks` shows tasks paused at "needs reconnect" or with stale `last_run`.
- `git worktree list` shows `/tmp/<task>-wt` directories whose parent session no longer exists.
- A PR sits at `mergeStateStatus: DIRTY` for more than 2h with no activity, despite an autonomous repair loop being expected.
- Wave Shepherd's queue contains entries with no recent assistant response.

Any **one** of these is enough to trigger this runbook — don't wait for confirmation from multiple signals.

---

## Immediate action (T+0)

The single most damaging post-restart side effect is **silently disabled crons**. Re-enable them first; everything else can be diagnosed afterward.

1. Surface paused/disabled scheduled tasks. From the orchestrator, run:
   ```
   mcp__scheduled-tasks__list_scheduled_tasks
   ```
   Look for any task whose `enabled` field is `false` or whose `next_run` is `null`. Common offenders:
   - `blus-bbq-hourly-update`
   - `blus-bbq-wave-shepherd`
   - `blus-bbq-post-merge-smoke`
2. Re-enable each disabled task with `mcp__scheduled-tasks__update_scheduled_task` (set `enabled: true`).
3. Note any task you re-enabled — you'll record this in the post-incident section below.

> **Do not** delete or recreate crons during recovery. A duplicate cron will double-fire and corrupt state. Re-enable in place.

---

## Diagnose (T+2)

From the repo root:

```bash
bash scripts/post-restart-inventory.sh
```

The script prints a single state snapshot covering:

- Active git worktrees (path, branch, dirty/clean, last commit age)
- Local-only commits ahead of `origin/<branch>` (recoverable via `git push`)
- Open PRs authored by the current user with their `mergeStateStatus`
- Recommended actions, ranked by data-loss risk

The script is read-only — it does not push, commit, or modify anything. Safe to run repeatedly.

> The active scheduled-tasks list is **not** queried by the script (those tools are orchestrator-side, not bash-callable). Run `mcp__scheduled-tasks__list_scheduled_tasks` separately and cross-reference with the script's output.

---

## Action map per inventory finding

Match each line in the inventory output to one of the following actions. Work top-to-bottom — the script's "Recommended actions" section is already ranked by urgency.

| Inventory finding | Action |
|---|---|
| `Worktree at /tmp/<X>-wt with N modified files` | Open the worktree, review the diff. If the work is meaningful, `git add` + `git commit` + `git push`. If it's scratch/garbage, `git stash` and surface the stash hash to the user before discarding. |
| `Worktree at /tmp/<X>-wt with N untracked files` | Same as above — untracked files are easy to lose. Prefer `git add -N` + commit over discarding. |
| `Branch <name> ahead of origin by N commits` | `git push origin <name>` (the commit already exists locally; just publish it). If the push is rejected as non-fast-forward, the remote diverged — surface to user, don't force-push. |
| `Open PR #N: mergeStateStatus DIRTY, last push >2h ago` | Check Wave Shepherd's queue for an active repair entry. If absent, spawn a repair task via `mcp__ccd_session__spawn_task` titled `Repair PR #N`. Do **not** rebase or force-push autonomously — repair tasks make a careful diagnosis first. |
| `Worktree on disk but branch missing locally` | Orphaned (the branch was deleted, but the worktree wasn't pruned). Safe to remove via `git worktree remove --force /tmp/<X>-wt`. |
| `Branch exists locally but no worktree, no recent activity` | Likely abandoned scratch. Confirm with `git log --oneline <branch>` — if the work was already merged or duplicated elsewhere, `git branch -D` is safe. Otherwise leave it. |

When in doubt, **commit + push** rather than delete. A pushed branch can always be removed later; lost uncommitted changes are unrecoverable.

---

## Verify (T+10)

After running the action map, confirm the system is healthy:

1. Production responds:
   ```bash
   curl -sf -o /dev/null -w "%{http_code}\n" https://blus-bbq.vercel.app/
   ```
   Expect `200`. Anything else, jump to `vercel-deploy-failed.md`.

2. Crons are running. Re-run `mcp__scheduled-tasks__list_scheduled_tasks` and confirm every task you re-enabled now has a `next_run` populated.

3. Smoke check the inquiries API (representative read path):
   ```bash
   curl -s https://blus-bbq.vercel.app/api/inquiries/list | jq '.inquiries | length'
   ```
   Should return a number, not an error.

4. Re-run the inventory script. The "Recommended actions" section should be empty (or contain only items the user explicitly chose to defer).

---

## Post-incident

After recovery, append a short entry to the incidents log below. Keep it to one paragraph: what was lost, root cause, what would have prevented it. The pattern matters more than the prose — a year from now the list of incidents is what tells us whether the auto-checkpoint protocol is working.

### Incidents

<!-- Append new incidents in reverse-chronological order. Format:

#### YYYY-MM-DD — short headline
- **Trigger:** what happened (reboot, OOM, etc.)
- **Lost:** N minutes of uncommitted work in <worktree>, or "nothing — auto-checkpoint caught it"
- **Root cause:** why the work was at risk (no checkpoint in N min, paused cron, etc.)
- **Prevention:** what we changed (or "this runbook"; concrete change beats hand-waving)
-->

_No incidents recorded yet. This runbook was added 2026-04-26 in response to the recovery pattern hitting often enough to deserve automation._

---

## Related runbooks

> Once `feat/eng-runbooks` (PR #95) merges, the eight runbooks below will exist on `main`. A restart event invalidates all in-flight task state — if you came here from any of these, finish post-restart recovery first, then return to the original triage.

- `post-merge-smoke-failed.md`
- `vercel-deploy-failed.md`
- `secret-rotation.md`
- `customer-profile-v2-flag.md`
- `parallel-branch-contention.md`
- `pr-stuck-in-bucket.md`
- `calendar-shows-wrong-events.md`
- `notifications-page-broken.md`
