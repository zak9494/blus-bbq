# Runbooks

Documented incident-response playbooks. Each runbook covers one concrete failure mode we have hit (or expect to hit), with copy-pasteable commands to triage and fix.

Every runbook follows the same shape:

| Section                  | What it answers                                             |
|--------------------------|-------------------------------------------------------------|
| **Symptoms**             | What does the user / monitor / cron see?                    |
| **Immediate action (T+0)** | One-line action to stop the bleeding                      |
| **Diagnose (T+5)**       | Commands to run, what to look for                           |
| **Root cause checklist** | Possible causes (ranked by likelihood)                      |
| **Fix**                  | Concrete steps                                              |
| **Verify**               | How to confirm the issue is resolved                        |
| **Post-incident**        | Postmortem? Add a monitor? Update a test?                   |

## Index

| Scenario                                                  | Runbook                                                   |
|-----------------------------------------------------------|-----------------------------------------------------------|
| Post-merge smoke cron fired a failure                     | [post-merge-smoke-failed.md](./post-merge-smoke-failed.md)|
| Vercel deploy errored                                     | [vercel-deploy-failed.md](./vercel-deploy-failed.md)      |
| Need to rotate `INQ_SECRET` / `SELF_MODIFY_SECRET` / etc  | [secret-rotation.md](./secret-rotation.md)                |
| `customer_profile_v2` flag misbehaves                     | [customer-profile-v2-flag.md](./customer-profile-v2-flag.md) |
| Parallel branch work polluted a PR diff                   | [parallel-branch-contention.md](./parallel-branch-contention.md) |
| A PR has been red / stalled for > 2h                      | [pr-stuck-in-bucket.md](./pr-stuck-in-bucket.md)          |
| Calendar shows the wrong events                           | [calendar-shows-wrong-events.md](./calendar-shows-wrong-events.md) |
| `/notifications` page broken                              | [notifications-page-broken.md](./notifications-page-broken.md) |
| Wave Shepherd GH Action red / no-op                       | [wave-shepherd-gh-action.md](./wave-shepherd-gh-action.md) |

## When to write a new runbook

When you fix a hotfix, **before** you close the loop, ask: would the next person see this? If yes, add a runbook. If no (one-off, environment-specific, or already obvious from the code), skip it.

When a hotfix task starts, the **first step** is to check if a runbook exists for that scenario. If yes, follow it. If no, write one as part of the fix — the runbook becomes part of the deliverable.
