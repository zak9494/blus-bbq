# Blu's BBQ — Status

_Updated: 2026-04-27T05:55Z (added Usage tracking section)_

## Right now (max 5)
[████░░░░░░] 40%  Inquiry notes editor (PR #115) — open, smoke red on baseline regression.
[██░░░░░░░░] 20%  Advance follow-up calendar UI (PR #118) — open, smoke red on baseline regression.
[█░░░░░░░░░] 10%  Post Catering Emails subsection (PR #120) — open, smoke red on baseline regression.

## Need your call (max 3)
- **🚧 Smoke wall is FLAG DRIFT, not KV.** Upstash PAYG cascade (10 PRs reran post-upgrade) merged 0 — every PR fails on `tests/smoke/core.spec.js:13` (Inquiries nav button visible) + `:31` (Calendar nav button visible). Root cause: `nav_v2` flag is OFF in production KV but `api/_lib/flags.js:113` declares `default: true`. The smoke test comment even claims "nav_v2 (default ON)". Fix options: (a) `setFlag('nav_v2', true)` via INQ_SECRET to align prod KV with seed, OR (b) update `tests/smoke/core.spec.js` to intercept `/api/flags` like `tests/smoke/nav-v2.spec.js` already does. Option (a) is one curl + a UI-impact decision; option (b) is the more durable fix.
- **📖 Review PR #108 (Postgres migration plan)** when ready — unblocks migration phase 1 (`api/_lib/db.js` scaffolding). Doc-only PR; the only thing keeping it red is the nav-button regression above.

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
✅ Merged (no new functional merges since 19:43Z — Upstash quota wall presumed cause; cascade attempt 04:45Z proved smoke wall is actually nav_v2 flag drift, see Need-your-call)
   (cascade 2026-04-27T04:45Z — 0 PRs merged; 10 reran, all red on same baseline regression)
   #119 Manual STATUS.md refresh — Wave 3 work in flight              ~5h ago
   #117 Manual STATUS.md refresh — smoke wall persists                ~6h ago
   #114 Manual STATUS.md refresh — new tasks spawned                  ~8h ago
   #113 Smoke quota-aware setFlag (skip not fail on KV 500)           ~10h ago
   #112 Manual STATUS.md refresh — task batch complete                ~12h ago
   #111 Manual STATUS.md refresh (initial)                            ~14h ago
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

🛠 Recently spawned / completed (no PR or PR open + blocked by nav_v2 flag drift)
   #121  Dessert email → AI approval queue — open, smoke red (baseline 2 + 2 PR-specific)
   #120  Post Catering Emails subsection — open, smoke red (baseline 2 + 6 PR-specific)
   #118  Advance follow-up calendar UI — open, smoke red (baseline 2 + 5 PR-specific)
   #115  Inquiry notes editor — open, smoke red (baseline 2 + 5 PR-specific)
   #110  Auto-update STATUS.md GH Action — open, CONFLICTING + smoke red
   #109  Post-restart recovery runbook (rebased) — open, smoke red (baseline 2 + 2 maps tests)
   #108  Postgres migration plan — open, smoke red (baseline 2 only — pure doc)
   #107  customer_profile_v2 assertion fix — open, smoke red (baseline 2 + 2 PR-specific)
   #93   wave3+5 flag seeds — open, smoke red (baseline 2 only)
   #67   audit batch C — open, smoke red (baseline 2 + 4 PR-specific)
   #51   customer profile Previous Quotes — open, smoke red (baseline 2 + 9 PR-specific)
   #94   Conv-commits — open, DIRTY (9 commits behind main), needs rebase

## Up next in queue (max 5)
1. Dessert email → approval queue routing         → Wave 3 (last NOT-STARTED item)

## Gated waiting
- Migration phase 1 — `api/_lib/db.js` scaffolding  → pending PR #108 review
- PR #94 rebase                                     → pending smoke-stable
- Tier 1 flag flips                                 → pending smoke-stable
- Wave 4 external-creds items                       → pending Mapbox / Sentry / Twilio / Stripe creds (see Your todo)

## Discussed, not queued (max 10)
- AI phone ordering          (SaaS scope)
- SEO landing pages          (SaaS scope)
- Stripe / Square go-live    (waiting on creds)
- Twilio 10DLC clearance     (waiting on approval)
- Tenant-aware refactor      (Q4 2026 prep)
- Postgres migration         (PR #108 scoping)

## Usage tracking

_For exact billing: claude.ai/settings/usage_

**Today (2026-04-27):**
- Code task spawns: ~12 (audit, cleanup, scoping, GH action, smoke harden v1, smoke harden v2, advance followup, inquiry notes, post catering, dessert, cascade, migration phase 1)
- PRs opened: 6+ (#108, #110, #113, #115, #117, #118, #120, #121, plus migration phase 1 PR pending)
- PRs merged: 9 cascaded after #96 admin-merge (#47, #48, #91, #95, #96, #101, #102, #103, #105) + STATUS refreshes
- Peak active code tasks: 5 (hit cap, queue managed sequentially)
- Wave Shepherd cron ticks: 12+ (every 30 min)
- Standing rules saved to memory: 5 (auto-checkpoint, sequential delivery, concurrent cap, queue discipline, STATUS.md push, speak-up, verify external, flag flip priority)

**Cumulative since 2026-04-22:**
- Total PRs merged: ~30+ (see git log)
- Active flags in production: ~40
- Open PRs as of now: 18 (see "Failed to merge" + in-flight)

**Rate-limit signals to watch for:**
- Anthropic Pro plan: ~50 messages per 5 hours; heavy days can hit limit
- If you hit a limit notice in claude.ai, the orchestrator will pause spawns until quota refreshes
- Switch to Max ($100/mo) or API plan for more headroom if Pro feels tight

## Wave progress
Wave 1 · Core UX + iOS feel               [██████████] 100%  2/2 ✓
Wave 2 · Quote Builder + infra            [██████████] 100% 10/10 ✓
Wave 3 · AI + notifications UX            [█████░░░░░]  50%  4/8
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
