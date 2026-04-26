# Blu's BBQ — Status

_Updated: 2026-04-26T17:33Z_

## Right now (max 5)
[██░░░░░░░░] 15%  Competitor research synthesis — Salesforce, Toast, QuickBooks, Gong, AI sales tools (Lavender, AISDR, Regie.ai), ClickUp marketing, voice AI ordering. Output: `docs/competitor-research/` per-competitor + prioritized "features to steal" backlog. Task `local_e5552f04` running.

## Need your call (max 3)
- PR #104 red 3h — docs(runbook): post-restart recovery procedure + inventory script
- PR #98 red 13h — feat(eng): branch protection on main + assertion test
- PR #97 red 13h — feat(eng): Sentry error tracking — flag-gated client + server

## Your todo (action when ready)

**🔑 Credentials / external accounts:**
- Mapbox token — https://account.mapbox.com/access-tokens/ → add `MAPBOX_TOKEN` to Vercel + redeploy
- Sentry DSN — sentry.io free tier → add `SENTRY_DSN` to Vercel (after Sentry PR lands)
- Twilio 10DLC clearance — fill `TWILIO_*` env vars in Vercel
- Stripe / Square go-live keys — pick provider, fill creds, set `PAYMENT_PROVIDER`

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
- `git reset --hard origin/main` in local clone (drops `cffd5aa`, `2560e47`)
- Enable branch protection in GitHub UI if API call fails

**🪝 Tooling acks (one-time when prompted):**
- First-run cron permission approvals (gh, git push) — approve once, future auto-approve

## Last 24 hours
✅ Merged
   #105  KV writes silently failed — toggles reverted on r… ~44min ago
   #103  migrate Wave Shepherd cron to GitHub Actions       ~2h ago
   #47   route AI-triggered sends through approval queue (… ~2h ago
   #91   chip filter accuracy — last-chip deselect, unlink… ~3h ago
   #48   require SELF_MODIFY_SECRET on /api/self-modify (c… ~3h ago
   #95   incident-response playbooks for 8 known failure m… ~3h ago
   #102  pipeline click routes to revise + hydrate from co… ~3h ago
   #101  competitor research synthesis (23 docs)            ~3h ago
   #96   bell flyout auto-closes on nav, Esc, outside click ~3h ago
   #100  unblock CI — drop brittle global-hamburger count … ~3h ago
   #99   show "TBD" instead of "12:00 AM" for events with … ~13h ago
   #46   await flags.load() before nav interactions — elim… ~13h ago
   #63   provider-agnostic payment adapter — stub/Stripe/S… ~14h ago
   #79   empty-state notice when shop origin unset          ~14h ago
   #62   scaffold sms_channel — send + status webhook, stu… ~14h ago
   #88   tiles + lost-reasons widget no longer stuck on "0" ~14h ago
   #61   Wave 2 QB extensions — discount, setup fee, tax o… ~14h ago
   #86   add tests/audit/post-merge-smoke.spec.js + cron p… ~15h ago
   #87   remove duplicate hamburger from /notifications pa… ~17h ago
   #65   audit batch A — phone, $totals, service chips, so… ~17h ago
   #82   /notifications page renders empty state instead o… ~18h ago
   #84   regression guard for INQ_SECRET dual-accept        ~18h ago
   #85   add SAVE regression spec — guard against the 401 … ~18h ago
   #83   merge KV inquiry events into /api/calendar/list o… ~18h ago
   #81   resolve "Loading…" hang on direct navigation       ~18h ago
   #75   quarter chicken requires 3+ meats                  ~18h ago
   #80   Lost system (standalone, ex-PR #68)                ~18h ago
   #76   STATUS.md + ROADMAP.md as single source of truth   ~19h ago
   #78   add Notifications sub-page entry under Settings    ~22h ago
   #64   events not rendering with v2 filters               ~23h ago
   #77   401 on load + duplicate hamburger nav              ~23h ago

❌ Failed to merge
   _(see Wave Shepherd cron output)_

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
Wave 1 · Core UX + iOS feel                    [██████████] 100% 2/2 ✓
Wave 2 · Quote Builder + infrastructure        [██████████] 100% 10/10 ✓
Wave 3 · AI + Notifications UX                 [█████░░░░░]  50% 4/8
Wave 4 · External integrations + creds         [█████░░░░░]  50% 2/4
Wave 5 · Calendar polish                       [████████░░]  75% 3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
