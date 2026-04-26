# Blu's BBQ — Status

_Updated: 2026-04-26T01:00Z_

## Right now (max 5)
[█████████░] 95%  PR #79 Maps empty-state banner — 286/287 CI green, 1 unrelated flake (thread-view timeout); awaiting flake dismiss
[██████░░░░] 60%  PR #61 Wave 2 QB extensions (discount, setup fee, tax override, due dates)
[███░░░░░░░] 30%  PR #62 SMS scaffold — stub mode, awaits Twilio 10DLC
[███░░░░░░░] 30%  PR #63 Payments adapter — Stripe/Square scaffold, awaits creds

## Need your call (max 3)
- Close PR #68 manually on GitHub — PR #80 already replaced it (Lost system shipped); #68 still technically open until you close it
- Run `git reset --hard origin/main` in your local clone to drop two stale commits (`cffd5aa`, `2560e47`) leftover from parallel-branch-contention. Local-only, no harm if skipped.
- Activate post-merge prod smoke cron (waiting on PR #86 merge — task `local_96d0832e` is handling, will activate the cron when files land)

## Last 24 hours
✅ Merged
   #86  post-merge smoke spec + cron prompt          ~12min ago
   #87  /notifications duplicate hamburger fix       ~2h ago
   #65  kanban audit batch A                         ~2h ago
   #82  /notifications page empty-state              ~2h ago
   #84  pipeline alerts INQ_SECRET regression test   ~3h ago
   #85  notif settings SAVE 401 regression test      ~3h ago
   #83  calendar v2 — KV inquiry events fix          ~3h ago
   #81  customer profile direct-nav loading hang     ~3h ago
   #75  Quarter chicken 3+ meat                      ~3h ago
   #80  Wave 1.5 Lost system (replaces #68)          ~3h ago
   #76  STATUS.md + ROADMAP.md tracking              ~4h ago
   #78  Notifications sub-page entry                 ~7h ago
   #64  Calendar v2 filters fix                      ~8h ago
   #77  notif-settings 401 + dup hamburger hotfix    ~8h ago

❌ Failed to merge
   _(none — all backlogged PRs cleared this round)_

## Up next in queue (max 5)
1. Editable pipeline notes                 → Wave 3
2. Advance follow-up calendar UI           → Wave 3
3. "Post Catering Emails" subsection       → Wave 3
4. Dessert email → approval queue          → Wave 3
5. Monthly/YTD sales breakdown dropdown    → Wave 5

## Discussed, not queued (max 10)
- AI phone ordering          (SaaS scope)
- SEO landing pages          (SaaS scope)
- Stripe / Square go-live    (waiting on creds)
- Twilio 10DLC clearance     (waiting on approval)
- Tenant-aware refactor      (Q4 2026 prep)

## Wave progress
Wave 1 · Core UX + iOS feel               [██████████] 100%  2/2 ✓
Wave 2 · Quote Builder + infra            [████░░░░░░]  40%  4/10
Wave 3 · AI + notifications UX            [█████░░░░░]  50%  4/8
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
