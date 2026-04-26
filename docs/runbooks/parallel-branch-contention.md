# Runbook: parallel branch contention polluted a PR diff

## Symptoms

- A PR diff suddenly contains commits you didn't write — usually labeled `chore(status):` or from another feature branch.
- `git log <pr-branch>..main` shows commits that look unrelated to the PR's intent.
- The PR description and the actual diff disagree by an order of magnitude.
- Reviewers ask "why is this PR also touching X?".

## Immediate action (T+0)

If the PR has not yet been merged: **do not merge it as-is.** Merging a PR with foreign commits will associate someone else's changes with your PR's reasoning in `git log`, and the auto-CHANGELOG (PR 5) will mis-attribute the work.

If the PR has already been merged with the foreign commits: a clean revert is rarely worth the disruption — the foreign commits are already in main from their own merge anyway. Just note it in `STATUS.md` and move on.

## Diagnose (T+5)

```bash
# What's actually in this branch beyond main?
git log --oneline origin/main..<pr-branch>

# Compare to what GitHub thinks the PR diff is
gh pr view <N> --json commits | jq '.commits[].messageHeadline'

# If they disagree, the branch is downstream of another feature branch instead of main
git merge-base <pr-branch> origin/main      # should match a recent main commit
git merge-base <pr-branch> <some-other-branch>  # if this is *more recent*, you branched from there
```

## Root cause checklist

- [ ] The branch was created with `git checkout -b <new>` while another feature branch was checked out, instead of from `main`.
- [ ] A `git pull` ran while a feature branch was checked out and pulled merges that didn't belong.
- [ ] An automation script branched from the current HEAD instead of explicitly from `origin/main`.
- [ ] The local `main` was stale — the new branch was branched from local-main, which had un-pushed commits from a previous task.

## Fix

The CLAUDE.md rule is explicit: **every branch must descend from `main`.** To recover from a polluted branch:

```bash
# 1. Save your real changes
git checkout <pr-branch>
git diff origin/main...<pr-branch> -- <files-you-actually-changed> > /tmp/my-real-changes.patch

# 2. Start over from main
git checkout main
git pull origin main
git checkout -b <pr-branch>-clean

# 3. Apply just your real changes
git apply /tmp/my-real-changes.patch
git add -A
git commit -m "<your conventional commit message>"

# 4. Replace the broken branch
git push -u origin <pr-branch>-clean

# 5. Open a fresh PR, close the old one with a comment pointing at the new one
gh pr close <N> --comment "Replaced by #<new>"
```

If you used a worktree, each worktree should be created **explicitly from `origin/main`**:

```bash
git worktree add /tmp/eng-feature -b feat/feature origin/main
#                                                  ^^^^^^^^^^^ critical
```

## Verify

```bash
# The new branch should only contain your commits
git log --oneline origin/main..<pr-branch>-clean

# Diff stat should match the PR's intended scope
git diff origin/main...<pr-branch>-clean --stat
```

## Post-incident

- If this was an automation bug (Wave Shepherd or similar branched from local HEAD instead of `origin/main`), file a fix on the orchestrator script.
- Add a memory rule: orchestrator NEVER branches from local HEAD — always `origin/main`.
- The CLAUDE.md "Branching Discipline" section already documents this; if the runbook fired, it means the section needs to be louder or earlier in the file.
