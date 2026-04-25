# Blu's BBQ — Roadmap

_Source of truth for the full backlog. Updated by Claude after every state change._
_For a daily glance, see [STATUS.md](./STATUS.md)._

## Wave 1 — Core UX + iOS feel  (1/2 complete)
- [ ] "Missed" highlight for past event dates — in PR #68 (open, CI green)
- [x] ~~quote_total on kanban cards~~ — DROPPED 2026-04-25 by Zach: "Not doing it." Code removed from PR #65.

## Wave 2 — Quote Builder + infrastructure  (3/10 complete)
- [x] $ alongside service charge % — shipped in PR #16
- [x] Default address setting — shipped in PR #74
- [x] Google Maps directions link — shipped in PR #72
- [ ] Discount field — in PR #61
- [ ] Setup fee conditional input — in PR #61
- [ ] Due date + deposit % + 2nd due date — in PR #61
- [ ] Tax rate override (currently hardcoded 8.25% in `quote-engine.js`) — in PR #61
- [ ] Quarter chicken 3+ meat logic — in PR #75 (open, CI green)
- [ ] SMS scaffold (`api/sms/`) — in PR #62
- [ ] Payment link abstraction (`api/payments/`) — in PR #63

## Wave 3 — AI + Notifications UX  (3/7 complete)
- [x] Notification Settings page — shipped in PR #70
- [x] Regenerate button in AI approval UI — shipped in PR #71
- [x] Add Details button in AI approval UI — shipped in PR #71
- [ ] "Post Catering Emails" subsection in Scheduled view
- [ ] Dessert email → approval queue (currently fires notification only via `ai_dessert_trigger`)
- [ ] Advance follow-up calendar UI (far-future bookings)
- [ ] Editable notes on pipeline/inquiry detail (separate from customer-profile notes)

## Wave 4 — External integrations + creds  (2/4 complete)
- [x] iMessage-style email thread view — shipped in PR #73
- [x] Google Maps embed — shipped in PR #72 (Mapbox)
- [ ] SMS activation — Twilio 10DLC pending; flip `sms_channel` flag once `TWILIO_*` env vars set
- [ ] Stripe / Square go-live — payment provider creds pending; switch via `PAYMENT_PROVIDER` env var

## Wave 5 — Calendar polish  (3/4 complete)
- [x] Desktop grid overflow fix — verified clean 2026-04-25 (5/5 Playwright at 1280×800)
- [x] Don't-delete-past-events protection — shipped in PR #41 (soft-delete past, confirm future)
- [x] Monthly / YTD sales totals — shipped in PR #32 (Group 8 Calendar enhancements)
- [ ] Monthly/YTD sales **breakdown dropdown** — partial impl behind `calendar_v2`, finish the breakdown UI

---

## Recently shipped (last 14 days, rolling)
_Most recent first. Auto-archived from STATUS.md "Last 24h" section._

- 2026-04-25 · #74 — Configurable shop origin address (remove hardcoded Dallas)
- 2026-04-25 · #73 — iMessage-style email thread view (`email_thread_v2`)
- 2026-04-25 · #72 — Mapbox distance + traffic-aware drive time (`maps_v1`)
- 2026-04-25 · #71 — AI approval Regenerate + Add Details (`ai_approval_actions_v1`)
- 2026-04-25 · #70 — Notification Settings page (`notification_settings_v1`)
- 2026-04-25 · #69 — smoke fix: customer_profile_v2 assertion ON
- 2026-04-24 · #59 — Date-range picker v2 + calendar status filters
- 2026-04-24 · #58 — PR template + branch-protection deny-list guardrails
- 2026-04-24 · #57 — Invoice Manager v1 (manual invoicing, payments, export)
- 2026-04-24 · #56 — Kanban + list view overhaul + pagination
- 2026-04-24 · #54 — Pipeline Sales Panel + Invoice Manager stub
- 2026-04-24 · #53 — Customer nav: quick card More info, list popup, QB back-routing
- 2026-04-23 · #44 — Re-init nav_v2 after flag toggle
- 2026-04-23 · #43 — Wave 1 Core UX (Today's Actions, kanban dropdown, customer tags, lost-reason)
- 2026-04-23 · #42 — Wave 0.5 iOS polish (PWA icons, safe-area, bottom-sheet, PTR, toggles)
- 2026-04-23 · #41 — Calendar delete protection (soft-delete past, confirm future)
- 2026-04-23 · #40 — Wave 0 docs: QA gate, SMS/payment lockdowns, feature modularity
- 2026-04-23 · #39 — nav_v2 default ON + bottom tab bar smoke test
- 2026-04-22 · #38 — Mobile hamburger touch target 38×38 → 44×44px
- 2026-04-22 · #37 — Group 9: Customer profile + widgets

## Backlog (unsorted — Zach appends here)
_New ideas land here. Claude sorts into the right Wave within 24 hours._

- _(empty)_
