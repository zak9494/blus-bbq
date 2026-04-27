# Blu's BBQ — Status

_Updated: 2026-04-27T00:12Z (manual refresh — new tasks spawned; auto-update PR #110 still blocked by smoke wall)_

## Right now (max 5)
[████░░░░░░] 40%  Editable inquiry notes (PR #115) — running.
[██████░░░░] 60%  Smoke hardening (PR #113) — admin-merge cascade in flight.
[█░░░░░░░░░] 10%  Advance follow-up calendar UI — just spawned.

## Need your call (max 3)
- **🚧 Smoke STILL failing post-quota-reset on PR #115** — worth investigating whether Upstash quota actually reset at 00:00 UTC or if a different limit is in play (monthly plan? per-key cap? rate-limit floor?). The daily reset was supposed to clear the 500K wall but smoke is still red.
- **🚧 Upstash KV quota** (original wall) — was 500K/500K daily; theoretically reset at 00:00 UTC (~12 min ago). PAYG upgrade ($10/mo) remains the immediate-unblock option if the reset didn't take.
- **📖 Review PR #108 (Postgres migration plan)** when you have time — unblocks migration phase 1 (`api/_lib/db.js` scaffolding).

## Your todo (action when ready)

**🔑 Credentials / external accounts:**
- Mapbox token — https://account.mapbox.com/access-tokens/ → add `MAPBOX_TOKEN` to Vercel + redeploy
- Sentry DSN — sentry.io free tier → add `SENTRY_DSN` to Vercel (after Sentry PR lands)
- Twilio 10DLC clearance — fill `TWILIO_*` env vars in Vercel
- Stripe / Square go-live keys — pick provider, fill creds, set `PAYMENT_PROVIDER`
- **Upstash PAYG upgrade** — $10/mo lifts the 500K/day cap; unblocks the smoke wall

**🎚 Flag flips (after each PR + you eyeball):**
- `maps_v1` — after MAPBOX_TOKEN + shop address set
- `qb_ext_wave2` — after PR #61 lands + QB fields verified
- `sentry_enabled` — after DSN in Vercel
- `kanban_restructure` + `kanban_edit_mode_v1` — after kanban verified
- `sms_channel` — after Twilio 10DLC cleared
- `payment_links_v1` — after Stripe/Square keys set

**✏️ Product decisions:**
- Dessert email destination — Notifications Center (current) or AI approval queue?
- "Delivery fee" — separate from setup fee, or covered by setup?
- Service type dropdown options — confirm: Pickup / Delivery (no setup) / Delivery + Setup / Delivery + Setup + Serving. Missing any?

**🧹 Cleanup:**
- Close PR #68 manually on GitHub (PR #80 replaced it)
- Close PR #104 manually on GitHub (PR #109 supersedes; comment posted)
- `git reset --hard origin/main` in local clone (drops `cffd5aa`, `2560e47`)
- Enable branch protection in GitHub UI if API call fails

**🪝 Tooling acks (one-time when prompted):**
- First-run cron permission approvals (gh, git push) — approve once, future auto-approve

## Last 24 hours
✅ Merged (no new functional merges since 19:43Z — Upstash quota wall holding everything; STATUS refresh PRs only)
   #112 Manual STATUS.md refresh — task batch complete                ~1.5h ago
   #111 Manual STATUS.md refresh (initial)                            ~4h ago
   #105 Flag toggle persistence — kvSet now loud on KV failure        ~4.5h ago
   #103 Wave Shepherd cron → GitHub Actions                           ~7h ago
   #47  AI-triggered sends route through approval queue               ~9h ago
   #91  Calendar chip filter accuracy                                 ~9h ago
   #48  Require SELF_MODIFY_SECRET on /api/self-modify                ~10h ago
   #95  Incident-response runbooks (8 known failure modes)            ~11h ago
   #102 QB pipeline click → revise + correct hydration                ~12h ago
   #101 Competitor research synthesis (23 docs)                       ~13h ago
   #96  Notifications bell flyout auto-close                          ~14h ago
   #100 Smoke unblock — drop brittle hamburger count                  ~15h ago
   #99  Calendar "TBD" instead of "12:00 AM"                          ~17h ago
   #46  await flags.load() before nav — CI flake fix                  ~21h ago
   #63  Payments adapter (stub/Stripe/Square)                         ~21h ago
   #79  Maps empty-state notice (shop-origin unset)                   ~21h ago
   #62  SMS scaffold (`sms_channel`, stub mode)                       ~21h ago
   #88  Pipeline tiles + lost-reasons widget fix                      ~21h ago
   #61  Wave 2 QB extensions (discount/fee/tax/dates)                 ~21h ago
   #86  post-merge smoke spec + cron prompt                           ~23h ago

🛠 Recently spawned / completed (no PR or PR open + blocked)
   #115  Editable inquiry notes — running
   Advance follow-up calendar UI — just spawned (no PR yet)
   #113  Smoke hardening — admin-merge cascade in flight
   #108  Postgres migration plan — scoping doc, opened on `docs/postgres-migration-plan-v2`
   #110  Auto-update STATUS.md GH Action — opened, blocked by smoke wall
   #94   Conv-commits — open, DIRTY (9 commits behind main), needs rebase post-quota-reset
   #107  customer_profile_v2 assertion fix — open, blocked by smoke wall
   #109  Post-restart recovery runbook — open, blocked by smoke wall

## Up next in queue (max 5)
1. Post Catering Emails subsection                → Wave 3
2. Dessert email → approval queue routing         → Wave 3
3. Migration phase 1 — `api/_lib/db.js` scaffolding → gated on PR #108 review
4. PR #94 rebase                                  → after smoke wall unblocks

## Discussed, not queued (max 10)
- AI phone ordering          (SaaS scope)
- SEO landing pages          (SaaS scope)
- Stripe / Square go-live    (waiting on creds)
- Twilio 10DLC clearance     (waiting on approval)
- Tenant-aware refactor      (Q4 2026 prep)
- Postgres migration         (PR #108 scoping)

## Wave progress
Wave 1 · Core UX + iOS feel               [██████████] 100%  2/2 ✓
Wave 2 · Quote Builder + infra            [██████████] 100% 10/10 ✓
Wave 3 · AI + notifications UX            [█████░░░░░]  50%  4/8
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
