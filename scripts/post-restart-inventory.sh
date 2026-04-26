#!/usr/bin/env bash
# post-restart-inventory.sh — read-only state snapshot after a restart event.
#
# Prints active worktrees, local-only commits, open PRs with stale merge state,
# and a ranked list of recommended actions. Does not push, commit, or modify
# anything — safe to run repeatedly on any tree state.
#
# See docs/runbooks/post-restart-recovery.md for usage and action mapping.

set -uo pipefail

# Resolve repo root so the script works from any CWD.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "error: not inside a git repository" >&2
  exit 1
fi
cd "$REPO_ROOT"

# Recommendations accumulator — populated as we discover findings, printed at end.
RECS=()
add_rec() { RECS+=("$1"); }

echo "=== Post-restart inventory ==="
echo "repo: $REPO_ROOT"
echo "as of: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo

# ---------------------------------------------------------------------------
# Section 1 — Active worktrees
# ---------------------------------------------------------------------------
echo "--- Active worktrees ---"
# `git worktree list --porcelain` emits records separated by blank lines:
#   worktree <path>
#   HEAD <sha>
#   branch refs/heads/<branch>     (or `detached`)
WORKTREE_COUNT=0
while IFS= read -r record; do
  [ -z "$record" ] && continue
  wt_path=$(printf '%s\n' "$record" | awk '/^worktree / {print $2}')
  wt_branch=$(printf '%s\n' "$record" | awk '/^branch / {print $2}' | sed 's|^refs/heads/||')
  wt_head=$(printf '%s\n' "$record" | awk '/^HEAD / {print $2}')
  [ -z "$wt_path" ] && continue
  WORKTREE_COUNT=$((WORKTREE_COUNT + 1))

  # Dirty status (modified + untracked counts) — run from the worktree itself.
  modified=$(git -C "$wt_path" status --porcelain 2>/dev/null | grep -cE '^.M|^M.|^A.|^.A|^D.|^.D|^R.|^.R' || true)
  untracked=$(git -C "$wt_path" status --porcelain 2>/dev/null | grep -c '^??' || true)

  # Last commit age (relative).
  last_commit_age="unknown"
  if [ -n "$wt_head" ]; then
    last_commit_age=$(git -C "$wt_path" log -1 --format='%cr' "$wt_head" 2>/dev/null || echo "unknown")
  fi

  status_str="clean"
  if [ "$modified" -gt 0 ] || [ "$untracked" -gt 0 ]; then
    status_str="${modified} modified, ${untracked} untracked"
  fi

  branch_label="${wt_branch:-detached}"
  echo "  ${wt_path}: branch ${branch_label}, status: ${status_str}, last commit ${last_commit_age}"

  if [ "$modified" -gt 0 ] || [ "$untracked" -gt 0 ]; then
    add_rec "Review uncommitted work in ${wt_path} (${status_str}); commit + push if meaningful"
  fi
done < <(git worktree list --porcelain; echo)

if [ "$WORKTREE_COUNT" -eq 0 ]; then
  echo "  (none)"
fi
echo

# ---------------------------------------------------------------------------
# Section 2 — Local-only commits not pushed to origin
# ---------------------------------------------------------------------------
echo "--- Local-only commits not pushed to origin ---"
AHEAD_COUNT=0
# Iterate every local branch; compare to its upstream if it has one.
while IFS= read -r branch; do
  [ -z "$branch" ] && continue
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name "${branch}@{upstream}" 2>/dev/null || true)
  if [ -z "$upstream" ]; then
    # No upstream — could be a brand-new local branch never pushed.
    head_sha=$(git rev-parse --short "$branch" 2>/dev/null || echo "?")
    echo "  ${branch}: no upstream tracking (HEAD ${head_sha})"
    add_rec "Push branch ${branch} to origin (currently has no upstream)"
    AHEAD_COUNT=$((AHEAD_COUNT + 1))
    continue
  fi
  ahead=$(git rev-list --count "${upstream}..${branch}" 2>/dev/null || echo 0)
  if [ "$ahead" -gt 0 ]; then
    shas=$(git log --format='%h' "${upstream}..${branch}" 2>/dev/null | tr '\n' ',' | sed 's/,$//; s/,/, /g')
    echo "  ${branch}: ${ahead} commits ahead of ${upstream} (${shas})"
    add_rec "Push ${branch}: ${ahead} commits ahead of ${upstream}"
    AHEAD_COUNT=$((AHEAD_COUNT + 1))
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

if [ "$AHEAD_COUNT" -eq 0 ]; then
  echo "  (none — all local branches in sync with origin)"
fi
echo

# ---------------------------------------------------------------------------
# Section 3 — Open PRs from this user
# ---------------------------------------------------------------------------
echo "--- Open PRs from this user ---"
if ! command -v gh >/dev/null 2>&1; then
  echo "  (gh CLI not installed — skipping)"
elif ! gh auth status >/dev/null 2>&1; then
  echo "  (gh not authenticated — skipping)"
else
  pr_json=$(gh pr list --author '@me' --state open \
    --json number,title,mergeStateStatus,updatedAt,headRefName 2>/dev/null || echo "[]")
  pr_count=$(printf '%s' "$pr_json" | jq 'length' 2>/dev/null || echo 0)

  if [ "$pr_count" -eq 0 ]; then
    echo "  (none)"
  else
    # Format: #N "title" - mergeStateStatus - updated <relative>
    printf '%s' "$pr_json" | jq -r '.[] | "  #\(.number) \"\(.title)\" — \(.mergeStateStatus) — branch \(.headRefName) — updated \(.updatedAt)"'

    # Flag PRs in DIRTY/UNKNOWN state with last push >2h ago.
    now_epoch=$(date -u +%s)
    while IFS= read -r row; do
      [ -z "$row" ] && continue
      number=$(printf '%s' "$row" | jq -r '.number')
      state=$(printf '%s' "$row" | jq -r '.mergeStateStatus')
      updated=$(printf '%s' "$row" | jq -r '.updatedAt')
      # macOS date vs GNU date — try both.
      upd_epoch=$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$updated" +%s 2>/dev/null \
                || date -d "$updated" +%s 2>/dev/null \
                || echo 0)
      if [ "$upd_epoch" -eq 0 ]; then continue; fi
      age_sec=$(( now_epoch - upd_epoch ))
      if [ "$state" = "DIRTY" ] && [ "$age_sec" -gt 7200 ]; then
        hours=$(( age_sec / 3600 ))
        add_rec "Spawn repair for PR #${number} (DIRTY for ${hours}h, no recent push)"
      fi
    done < <(printf '%s' "$pr_json" | jq -c '.[]')
  fi
fi
echo

# ---------------------------------------------------------------------------
# Section 4 — Active scheduled tasks
# ---------------------------------------------------------------------------
echo "--- Active scheduled tasks ---"
echo "  (orchestrator-side — run via Dispatch:"
echo "   mcp__scheduled-tasks__list_scheduled_tasks)"
echo "  Cross-reference: any task with enabled=false or null next_run needs"
echo "  re-enabling via mcp__scheduled-tasks__update_scheduled_task."
echo

# ---------------------------------------------------------------------------
# Section 5 — Recommended actions (ranked)
# ---------------------------------------------------------------------------
echo "--- Recommended actions ---"
if [ "${#RECS[@]}" -eq 0 ]; then
  echo "  (none — tree looks clean)"
else
  i=1
  for rec in "${RECS[@]}"; do
    echo "  ${i}. ${rec}"
    i=$((i + 1))
  done
fi
echo

exit 0
