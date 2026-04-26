# Blu's BBQ — Status

_Updated: 2026-04-26T02:30Z_

## Right now (max 5)
[██░░░░░░░░] 15%  Competitor research synthesis — Salesforce, Toast, QuickBooks, Gong, AI sales tools (Lavender, AISDR, Regie.ai), ClickUp marketing, voice AI ordering. Output: `docs/competitor-research/` per-competitor + prioritized "features to steal" backlog. Task `local_e5552f04` running.

## Need your call (max 3)
_(no urgent blockers right now)_

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
   #46  await flags.load() before nav — CI flake fix  ~recent
   #63  Payments adapter (stub/Stripe/Square)         ~recent
   #79  Maps empty-state notice (shop-origin unset)   ~30min ago
   #62  SMS scaffold (`sms_channel`, stub mode)       ~50min ago
   #88  Pipeline tiles + lost-reasons widget fix      ~50min ago
   #61  Wave 2 QB extensions (discount/fee/tax/dates) ~50min ago
   #86  post-merge smoke spec + cron prompt           ~2h ago
   #87  /notifications duplicate hamburger fix        ~3h ago
   #65  kanban audit batch A                          ~3h ago
   #82  /notifications page empty-state               ~3h ago
   #84  pipeline alerts INQ_SECRET regression test    ~4h ago
   #85  notif settings SAVE 401 regression test       ~4h ago
   #83  calendar v2 — KV inquiry events fix           ~4h ago
   #81  customer profile direct-nav loading hang      ~4h ago
   #75  Quarter chicken 3+ meat                       ~4h ago
   #80  Wave 1.5 Lost system (replaces #68)           ~5h ago

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
Wave 2 · Quote Builder + infra            [██████████] 100% 10/10 ✓
Wave 3 · AI + notifications UX            [█████░░░░░]  50%  4/8
Wave 4 · External integrations + creds    [█████░░░░░]  50%  2/4
Wave 5 · Calendar polish                  [████████░░]  75%  3/4

---
[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)
