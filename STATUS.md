# Blu's BBQ — Status

_Updated: 2026-04-26T19:43Z (manual refresh — auto-update PR #110 still blocked by smoke wall)_

## Right now (max 5)
[████░░░░░░] 40%  PR #110 — `feat(ci): auto-regenerate STATUS.md on push to main`. Once green + merged, this manual refresh becomes the last one.
[██░░░░░░░░] 20%  PR #108 — `docs(migration): Postgres migration plan`. Scoping doc only; design phase.
[█████████░] 90%  Backlog cleanup task wrapping up: #105 merged, #107 (flag-drift) and #109 (post-restart runbook) opened, #94 lockfile fix pushed (still DIRTY + smoke didn't auto-trigger).

## Need your call (max 3)
- **🚧 Upstash KV quota exhausted (500K/500K)** — blocking ~16 open PRs on the Playwright smoke suite. Symptom: any test that calls `setFlag()` to flip a flag returns HTTP 500 (correct loud-failure behavior post-#105) and downstream selectors time out. **Options:** wait for the daily reset (00:00 UTC) or upgrade to PAYG (~$10/mo). Until then, every smoke run reports failures even on otherwise-correct PRs.

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
✅ Merged
   #105 Flag toggle persistence — kvSet now loud on KV failure   ~30min ago
   #103 Wave Shepherd cron → GitHub Actions                      ~3h ago
   #47  AI-triggered sends route through approval queue          ~5h ago
   #91  Calendar chip filter accuracy                            ~5h ago
   #48  Require SELF_MODIFY_SECRET on /api/self-modify           ~6h ago
   #95  Incident-response runbooks (8 known failure modes)       ~7h ago
   #102 QB pipeline click → revise + correct hydration           ~8h ago
   #101 Competitor research synthesis (23 docs)                  ~9h ago
   #96  Notifications bell flyout auto-close                     ~10h ago
   #100 Smoke unblock — drop brittle hamburger count             ~11h ago
   #99  Calendar "TBD" instead of "12:00 AM"                     ~13h ago
   #46  await flags.load() before nav — CI flake fix             ~17h ago
   #63  Payments adapter (stub/Stripe/Square)                    ~17h ago
   #79  Maps empty-state notice (shop-origin unset)              ~17h ago
   #62  SMS scaffold (`sms_channel`, stub mode)                  ~17h ago
   #88  Pipeline tiles + lost-reasons widget fix                 ~17h ago
   #61  Wave 2 QB extensions (discount/fee/tax/dates)            ~17h ago
   #86  post-merge smoke spec + cron prompt                      ~19h ago
   #87  /notifications duplicate hamburger fix                   ~20h ago
   #65  kanban audit batch A                                     ~20h ago
   #82  /notifications page empty-state                          ~20h ago

❌ Failed to merge
   #94  feat(eng): conv-commits — smoke didn't auto-trigger on lockfile fix; branch 9 commits behind main (DIRTY)
   #107 fix(smoke): customer_profile_v2 assertion — blocked by Upstash KV quota → thread-view smoke timeouts
   #109 docs(runbook): post-restart recovery — same Upstash KV smoke wall

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
- Postgres migration         (PR #108 scoping)

## Wave progress
Wave 1 · Core UX + iOS feel               [██████████] 100%  2/2 ✓
Wave 2 · Quote Builder + infra            [██████████] 100% 10/10 ✓
Wave 3 · AI + notifications UX            [█████░░░░░]  50%  4/8
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
