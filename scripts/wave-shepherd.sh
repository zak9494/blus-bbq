#!/usr/bin/env bash
# wave-shepherd.sh — GitHub Actions edition of the local Wave Shepherd cron.
#
# Triages open PRs in the repo:
#   - CLEAN + green + label `auto-merge-ok`  -> squash-merge (manual control valve)
#   - CI failing for >1h                     -> comment + rerun failed jobs
#   - mergeStateStatus DIRTY                 -> comment "needs rebase"
#   - >4 days untouched + failing CI         -> comment "stalled, close if dead"
#
# Then writes a markdown summary and, if anything has been stuck >2h, opens
# (or appends to) a daily alert issue.
#
# Env knobs:
#   REPO           owner/name (default: $GITHUB_REPOSITORY or zachblume/blus-bbq)
#   DRY_RUN=1      log gh calls but don't execute mutations
#   SUMMARY_DIR    where to write shepherd-summary-<ts>.md (default: cwd)
#   ALERT_LABEL    issue label for the daily alert (default: wave-shepherd)
#
# Requires: gh, jq, date (GNU), bash 4+.

set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:-zak9494/blus-bbq}}"
DRY_RUN="${DRY_RUN:-0}"
SUMMARY_DIR="${SUMMARY_DIR:-.}"
ALERT_LABEL="${ALERT_LABEL:-wave-shepherd}"

NOW_EPOCH=$(date -u +%s)
TODAY=$(date -u +%F)
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
SUMMARY_FILE="${SUMMARY_DIR}/shepherd-summary-${TIMESTAMP}.md"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { echo "[shepherd] $*" >&2; }

iso_to_epoch() {
  local ts="${1:-}"
  if [ -z "$ts" ] || [ "$ts" = "null" ]; then echo 0; return; fi
  # GNU date on ubuntu-latest; falls back to 0 if the format is unexpected.
  date -u -d "$ts" +%s 2>/dev/null || echo 0
}

mins_since() {
  local epoch="${1:-0}"
  if [ "$epoch" -le 0 ]; then echo 0; return; fi
  echo $(( (NOW_EPOCH - epoch) / 60 ))
}

gh_mut() {
  # Wrapper for mutating gh commands; respects DRY_RUN.
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] gh $*"
    return 0
  fi
  gh "$@"
}

pr_comment() {
  local num="$1"; shift
  local body="$1"; shift
  gh_mut pr comment "$num" --repo "$REPO" --body "$body" >/dev/null || \
    log "WARN: failed to comment on #$num"
}

# ---------------------------------------------------------------------------
# Step 1 — enumerate open PRs
# ---------------------------------------------------------------------------

log "Fetching open PRs for $REPO..."
PR_DATA=$(gh pr list --repo "$REPO" --state open --limit 50 --json \
  number,title,url,headRefName,mergeStateStatus,isDraft,labels,updatedAt,createdAt,author,statusCheckRollup \
  2>/dev/null || echo '[]')

PR_COUNT=$(echo "$PR_DATA" | jq 'length')
log "Found $PR_COUNT open PRs"

# Buckets — number|title pairs, joined later for the summary.
CLEAN_GREEN=()
AUTO_MERGED=()
CI_FAILING_SHORT=()
CI_FAILING_LONG=()
DIRTY_PRS=()
ABANDONED=()
STALLED_2H=()
DRAFTS=()
OTHER=()

# ---------------------------------------------------------------------------
# Step 2 — classify each PR and apply actions
# ---------------------------------------------------------------------------

# Iterate over PRs. We use process substitution + jq to emit one TSV row per PR
# so the bash loop can stay simple.
while IFS=$'\t' read -r NUMBER TITLE URL HEADREF MERGE_STATE IS_DRAFT UPDATED_AT CREATED_AT LABELS_JSON CHECKS_JSON; do
  [ -z "${NUMBER:-}" ] && continue

  UPDATED_EPOCH=$(iso_to_epoch "$UPDATED_AT")
  CREATED_EPOCH=$(iso_to_epoch "$CREATED_AT")
  MINS_SINCE_UPDATE=$(mins_since "$UPDATED_EPOCH")
  DAYS_SINCE_UPDATE=$(( MINS_SINCE_UPDATE / 60 / 24 ))

  HAS_AUTO_MERGE_LABEL=$(echo "$LABELS_JSON" | jq -r '[.[] | .name] | index("auto-merge-ok") // false' )
  if [ "$HAS_AUTO_MERGE_LABEL" = "false" ] || [ "$HAS_AUTO_MERGE_LABEL" = "null" ]; then
    HAS_AUTO_MERGE_LABEL=0
  else
    HAS_AUTO_MERGE_LABEL=1
  fi

  # Aggregate check status from statusCheckRollup. Each entry is either a
  # CheckRun (status/conclusion fields) or a StatusContext (state field).
  FAIL_COUNT=$(echo "$CHECKS_JSON" | jq '
    ([.[] | select((.conclusion // "") | IN("FAILURE","TIMED_OUT","ERROR","CANCELLED","STARTUP_FAILURE"))]
     + [.[] | select((.state // "") | IN("FAILURE","ERROR"))]) | length')
  PENDING_COUNT=$(echo "$CHECKS_JSON" | jq '
    ([.[] | select((.status // "") | IN("IN_PROGRESS","QUEUED","PENDING"))]
     + [.[] | select((.state // "") | IN("PENDING","EXPECTED"))]) | length')
  TOTAL_COUNT=$(echo "$CHECKS_JSON" | jq 'length')
  LATEST_FAIL_COMPLETED=$(echo "$CHECKS_JSON" | jq -r '
    ([.[] | select((.conclusion // "") | IN("FAILURE","TIMED_OUT","ERROR","CANCELLED","STARTUP_FAILURE")) | (.completedAt // .startedAt // "")]
     + [.[] | select((.state // "") | IN("FAILURE","ERROR")) | (.createdAt // "")])
    | map(select(. != "")) | sort | reverse | .[0] // ""')
  LATEST_FAIL_EPOCH=$(iso_to_epoch "$LATEST_FAIL_COMPLETED")
  MINS_SINCE_FAIL=$(mins_since "$LATEST_FAIL_EPOCH")

  ENTRY="#${NUMBER} ${TITLE} (${URL})"

  if [ "$IS_DRAFT" = "true" ]; then
    DRAFTS+=("$ENTRY")
    continue
  fi

  # --- Bucket: DIRTY ----------------------------------------------------
  if [ "$MERGE_STATE" = "DIRTY" ]; then
    DIRTY_PRS+=("$ENTRY (updated ${DAYS_SINCE_UPDATE}d ago)")
    pr_comment "$NUMBER" "🐑 **Wave Shepherd**: branch is **DIRTY** — needs a rebase from \`main\` before it can merge. (Auto-detected by [wave-shepherd workflow](https://github.com/${REPO}/actions/workflows/wave-shepherd.yml).)"
    if [ "$MINS_SINCE_UPDATE" -gt 120 ]; then
      STALLED_2H+=("$ENTRY — DIRTY for ${DAYS_SINCE_UPDATE}d")
    fi
    continue
  fi

  # --- Bucket: ABANDONED (>4d untouched, red CI) -----------------------
  if [ "$DAYS_SINCE_UPDATE" -ge 4 ] && [ "$FAIL_COUNT" -gt 0 ]; then
    ABANDONED+=("$ENTRY (idle ${DAYS_SINCE_UPDATE}d, ${FAIL_COUNT} failing checks)")
    pr_comment "$NUMBER" "🐑 **Wave Shepherd**: this PR has been idle for ${DAYS_SINCE_UPDATE} days with failing CI. **Close it if it's no longer relevant**, or push a fix to revive it. (Wave Shepherd will not auto-close.)"
    STALLED_2H+=("$ENTRY — abandoned ${DAYS_SINCE_UPDATE}d, red")
    continue
  fi

  # --- Bucket: CI failing ----------------------------------------------
  if [ "$FAIL_COUNT" -gt 0 ]; then
    if [ "$MINS_SINCE_FAIL" -gt 60 ]; then
      CI_FAILING_LONG+=("$ENTRY (${FAIL_COUNT} failing, ${MINS_SINCE_FAIL}m old)")
      pr_comment "$NUMBER" "🐑 **Wave Shepherd**: CI has been red for >1h (${MINS_SINCE_FAIL}m). Re-running failed jobs once before flagging."
      # Re-run the most recent failing run on the head SHA. Best effort.
      LATEST_RUN_ID=$(gh run list --repo "$REPO" --branch "$HEADREF" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "")
      if [ -n "$LATEST_RUN_ID" ]; then
        gh_mut run rerun "$LATEST_RUN_ID" --repo "$REPO" --failed >/dev/null 2>&1 || \
          log "WARN: rerun --failed failed for #$NUMBER (run $LATEST_RUN_ID)"
      else
        log "WARN: no recent run found for branch $HEADREF (#$NUMBER)"
      fi
      STALLED_2H+=("$ENTRY — CI red ${MINS_SINCE_FAIL}m")
    else
      CI_FAILING_SHORT+=("$ENTRY (${FAIL_COUNT} failing, ${MINS_SINCE_FAIL}m old)")
    fi
    continue
  fi

  # --- Bucket: CLEAN + green -------------------------------------------
  if [ "$MERGE_STATE" = "CLEAN" ] && [ "$PENDING_COUNT" -eq 0 ] && [ "$FAIL_COUNT" -eq 0 ] && [ "$TOTAL_COUNT" -gt 0 ]; then
    if [ "$HAS_AUTO_MERGE_LABEL" = "1" ]; then
      log "Auto-merging #$NUMBER (auto-merge-ok label, CLEAN, green)"
      if gh_mut pr merge "$NUMBER" --repo "$REPO" --squash --delete-branch >/dev/null 2>&1; then
        AUTO_MERGED+=("$ENTRY")
      else
        log "WARN: auto-merge failed for #$NUMBER"
        CLEAN_GREEN+=("$ENTRY (auto-merge attempted, failed)")
      fi
    else
      CLEAN_GREEN+=("$ENTRY")
    fi
    continue
  fi

  # --- Fallback ---------------------------------------------------------
  OTHER+=("$ENTRY (state=${MERGE_STATE}, checks ${FAIL_COUNT}f/${PENDING_COUNT}p/${TOTAL_COUNT}t)")
done < <(echo "$PR_DATA" | jq -r '.[] | [
  (.number|tostring),
  (.title|gsub("\t";" ")),
  .url,
  .headRefName,
  .mergeStateStatus,
  (.isDraft|tostring),
  .updatedAt,
  .createdAt,
  (.labels // [] | tojson),
  (.statusCheckRollup // [] | tojson)
] | @tsv')

# ---------------------------------------------------------------------------
# Step 3 — write summary file
# ---------------------------------------------------------------------------

mkdir -p "$SUMMARY_DIR"

write_section() {
  # Args: heading, then zero or more items. Bash 3-compatible (no nameref) so
  # this script can be smoke-tested on macOS too.
  local heading="$1"; shift
  local count="$#"
  echo "" >> "$SUMMARY_FILE"
  echo "## $heading ($count)" >> "$SUMMARY_FILE"
  if [ "$count" -eq 0 ]; then
    echo "_none_" >> "$SUMMARY_FILE"
    return
  fi
  for item in "$@"; do
    echo "- $item" >> "$SUMMARY_FILE"
  done
}

{
  echo "# Wave Shepherd — $(date -u +'%Y-%m-%d %H:%M UTC')"
  echo ""
  echo "Repo: \`$REPO\` · Open PRs: $PR_COUNT · Run: \`${GITHUB_RUN_ID:-local}\`"
} > "$SUMMARY_FILE"

# NB: ${arr[@]+"${arr[@]}"} is the bash-3-safe way to pass a possibly-empty
# array under `set -u`.
write_section "Auto-merged this run"                              ${AUTO_MERGED[@]+"${AUTO_MERGED[@]}"}
write_section "CLEAN + green (awaiting human merge)"              ${CLEAN_GREEN[@]+"${CLEAN_GREEN[@]}"}
write_section "CI failing <1h (watching)"                         ${CI_FAILING_SHORT[@]+"${CI_FAILING_SHORT[@]}"}
write_section "CI failing >1h (commented + rerun triggered)"      ${CI_FAILING_LONG[@]+"${CI_FAILING_LONG[@]}"}
write_section "DIRTY — needs rebase (commented)"                  ${DIRTY_PRS[@]+"${DIRTY_PRS[@]}"}
write_section "Abandoned >4d w/ red CI (commented, no auto-close)" ${ABANDONED[@]+"${ABANDONED[@]}"}
write_section "Drafts (skipped)"                                  ${DRAFTS[@]+"${DRAFTS[@]}"}
write_section "Other / unclassified"                              ${OTHER[@]+"${OTHER[@]}"}

echo "" >> "$SUMMARY_FILE"
echo "---" >> "$SUMMARY_FILE"
echo "Stalled >2h: ${#STALLED_2H[@]}" >> "$SUMMARY_FILE"

log "Summary written to $SUMMARY_FILE"

# Echo to stdout so the Actions log captures it.
cat "$SUMMARY_FILE"

# ---------------------------------------------------------------------------
# Step 4 — daily alert issue if anything is stuck >2h
# ---------------------------------------------------------------------------

if [ "${#STALLED_2H[@]}" -eq 0 ]; then
  log "Nothing stalled >2h — no alert issue."
  exit 0
fi

ALERT_TITLE="wave-shepherd alert: $TODAY"
log "Stalled >2h: ${#STALLED_2H[@]} — checking for existing alert issue '$ALERT_TITLE'"

# Find an open issue with today's title (label-scoped to keep the search tight).
EXISTING_ISSUE=$(gh issue list --repo "$REPO" --state open --label "$ALERT_LABEL" \
  --search "in:title \"$ALERT_TITLE\"" --json number --jq '.[0].number // empty' 2>/dev/null || echo "")

ALERT_BODY=$(printf '%s\n\n' "Wave Shepherd run at $(date -u +'%H:%M UTC') flagged ${#STALLED_2H[@]} stalled PR(s):"
  for item in "${STALLED_2H[@]}"; do printf -- '- %s\n' "$item"; done
  printf '\nSummary artifact: shepherd-summary-%s.md (workflow run %s).\n' "$TIMESTAMP" "${GITHUB_RUN_ID:-local}")

if [ -n "$EXISTING_ISSUE" ]; then
  log "Appending update to existing issue #$EXISTING_ISSUE"
  gh_mut issue comment "$EXISTING_ISSUE" --repo "$REPO" --body "$ALERT_BODY" >/dev/null
else
  log "Opening new alert issue"
  # Ensure the label exists (idempotent: ignore "already exists").
  gh_mut label create "$ALERT_LABEL" --repo "$REPO" --color "fbca04" \
    --description "Posted by .github/workflows/wave-shepherd.yml" >/dev/null 2>&1 || true
  gh_mut issue create --repo "$REPO" --title "$ALERT_TITLE" --label "$ALERT_LABEL" --body "$ALERT_BODY" >/dev/null
fi

log "Done."
