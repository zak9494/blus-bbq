# Blu's BBQ — Status

_Updated: 2026-04-25T21:00Z_

## Right now (max 5)
[█████████░] 95%  PR #79 Maps empty-state banner — 286/287 CI green, 1 unrelated flake (thread-view timeout); awaiting flake dismiss
[████░░░░░░] 40%  PR #75 Quarter chicken 3+ meat — CI green but DIRTY conflict on `flags.js` + `self-modify.js`; needs rebase from main
[██████░░░░] 60%  PR #61 Wave 2 QB extensions (discount, setup fee, tax override, due dates)
[███░░░░░░░] 30%  PR #62 SMS scaffold — stub mode, awaits Twilio 10DLC
[███░░░░░░░] 30%  PR #63 Payments adapter — Stripe/Square scaffold, awaits creds

## Need your call (max 3)
- Mapbox env vars — `MAPBOX_TOKEN` + `BLUS_BBQ_ORIGIN_ADDRESS` set in Vercel? Needed before flipping `maps_v1` ON.
- Restore `customer_profile_v2` flag — flipped OFF 2026-04-24 to unblock CI; safe to flip back ON now that all April-24 PRs merged?
- 4 hotfix branches awaiting your go-ahead from audit findings (see 🔴 Broken in production below)

## 🔴 Broken in production (awaiting hotfix)
- `/notifications` page — "Failed to load" — endpoints don't exist server-side
- Notification Settings save — 401 — wrong env var read (load was fixed in #77)
- Pipeline alerts banner (Kanban + List) — silent 401 — secret name mismatch
- Customer Profile direct-nav — stuck on "Loading…" — `init()` is a no-op

## Last 24 hours
✅ Merged
   #76  STATUS.md + ROADMAP.md tracking                ~5min ago
   #78  Notifications sub-page entry under Settings    ~30min ago
   #64  Calendar v2 filters fix                        ~30min ago
   #77  notif-settings 401 + dup hamburger hotfix      ~1h ago
   #74  shop-origin setting                            ~4h ago
   #73  iMessage email thread view                     ~4h ago
   #72  Mapbox distance + traffic-aware drive time     ~4h ago
   #71  AI approval — Regenerate + Add Details         ~4h ago
   #70  Notification Settings page                     ~5h ago
   #69  smoke fix (customer_profile_v2 assertion)      ~5h ago

❌ Failed to merge
   #75  Quarter chicken 3+ meat — DIRTY conflict, needs rebase
   #65  quote_total drop — skipped during merge orchestration
   #68  Wave 1.5 Lost system — stacked on failing #64-67

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
Wave 1 · Core UX + iOS feel               [█████░░░░░]  50%  1/2
Wave 2 · Quote Builder + infra            [███░░░░░░░]  30%  3/10
Wave 3 · AI + notifications UX            [█████░░░░░]  50%  4/8
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
