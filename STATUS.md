# Blu's BBQ — Status

_Updated: 2026-04-25T17:58Z_

## Right now (max 5)
[█████████░] 90%  PR #68 Wave 1.5 Lost system — CI green, awaiting merge
[█████████░] 90%  PR #75 Quarter chicken 3+ meat — CI green, awaiting merge
[██████░░░░] 60%  PR #61 Wave 2 QB extensions (discount, setup fee, tax override, due dates)
[███░░░░░░░] 30%  PR #62 SMS scaffold — stub mode, awaits Twilio 10DLC
[███░░░░░░░] 30%  PR #63 Payments adapter — Stripe/Square scaffold, awaits creds

## Need your call (max 3)
- Notification Settings nav slot — bottom tab bar at 5/5; replace one, add overflow menu, or push to settings sub-page?
- Mapbox env vars — `MAPBOX_TOKEN` + `BLUS_BBQ_ORIGIN_ADDRESS` set in Vercel? Needed before flipping `maps_v1` ON.
- Restore `customer_profile_v2` flag — flipped OFF 2026-04-24 to unblock CI; safe to flip back ON now that #69-#74 merged?

## Last 24 hours
✅ Merged
   #74  shop-origin setting                           ~1h ago
   #73  iMessage email thread view                    ~1h ago
   #72  Mapbox distance + traffic-aware drive time    ~1h ago
   #71  AI approval — Regenerate + Add Details        ~1h ago
   #70  Notification Settings page                    ~2h ago
   #69  smoke fix (customer_profile_v2 assertion)     ~2h ago

❌ Failed to merge
   _(none in window — repair round on 2026-04-25 cleared all 6 awaiting PRs)_

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
Wave 3 · AI + notifications UX            [████░░░░░░]  43%  3/7
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
