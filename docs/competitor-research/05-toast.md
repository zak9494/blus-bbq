# Toast

Research date: 2026-04-25. Focus: Toast POS as a whole, with deep dive into the Catering & Events module (and Catering & Events Pro).

## A. Core value prop

Toast is the dominant restaurant-specific cloud POS in the US — a vertically integrated stack covering POS, KDS, online ordering, payroll, marketing, loyalty, and (since 2024) a purpose-built Catering & Events module that bolts onto the same payment, calendar, and inventory backbone. Sold as "one system to run your restaurant," but in practice it's a paid-module flywheel where every additional capability is a separate line item.

## B. Top 5 features worth copying

1. **BEO + lead-form templating with custom fields per template.** Toast ships three BEO templates (Catering, Event, Custom) and lets the operator add fields with type metadata (text, yes/no, multi-line, employee, time, select) and flags (required / priority / internal-only). The lead intake form mirrors the BEO so the customer-facing fields populate the internal record automatically. Direct copy candidate for our inquiry → quote pipeline; we currently extract free-form fields with Claude but have no schema.
2. **Calendar-driven event status pipeline (TENTATIVE → CONFIRMED → PAID → PAST DUE).** Status is derived from estimate/invoice lifecycle, not a manual flag. We already have a pipeline kanban; mapping it to deposit/invoice state instead of manual stage drags would cut data entry.
3. **Prep tools as one-click downloads from any event.** From the event detail screen, operators export: prep list, invoice, BEO, kitchen sheet, pickup summary, delivery summary, pack sheet, order summary, CSV, and labels. Each filter is tool-specific (e.g., labels for to-go bags). Direct copy: a "print pack" button on each Blu's inquiry that produces all of these from the existing quote+menu data we already have.
4. **EventView (branded guest portal).** Pro tier serves a single branded URL per event where the customer sees estimate, payment status, signed contract, and (in Pro) a Discussions thread. Replaces email back-and-forth. For the SaaS pivot, this is high-leverage — every multi-tenant catering CRM should give the caterer a per-event share link that's tenant-branded.
5. **Event Areas (double-booking prevention).** Pro tier lets you define "areas" (kitchen capacity, dining room, smoker line, delivery van) and blocks scheduling conflicts. For a BBQ caterer with finite smoker capacity per Saturday this is a real operational gain, not a UI gimmick.

## C. Notable UI patterns

- **Operations command center feel.** The home screen for Catering & Events is a calendar-first view (month/week/day toggle) with filter chips for status; selecting an event slides in a right-rail detail pane rather than navigating away. The same interaction pattern repeats across the POS — the calendar is the central object, not a sub-page.
- **Inline status chips drive every list view.** TENTATIVE / CONFIRMED / PAID / PAST DUE are color-coded and clickable to filter. Mirrors how our `#inq-chips` work but Toast also exposes them on calendar tiles.
- **Customer-facing branded pages share a chrome with the operator views** — the EventView portal looks like a stripped-down version of the operator BEO screen, which signals continuity without exposing internal fields.
- **Hardware-aware layout.** Toast handhelds have a different layout from Toast terminals — same data model, different screens. We should plan for iPad-handheld vs. desktop divergence early, not retrofit later.
- **Heavy reliance on slide-over modals** for create/edit instead of full-page forms; keeps the calendar context behind the modal. Cheap to copy, big perceived-quality win.

## D. Data model insights

Catering & Events is bolted onto Toast's POS data model and that shows in the schema:

- **Event**: parent record with status enum, owner (employee), event type (template), timeline (start/end), area (capacity bucket), guest count, custom-field bag.
- **BEO template**: defines field schema for events of that type. Field metadata includes name, type, required/priority/internal flags. Lead forms render the non-internal fields publicly.
- **Order**: line items pulled from the master menu (same items as in-store POS), with per-event modifiers and tax rules. Catering orders inherit the location's tax profile but allow per-event tax-exempt override (org/non-profit case).
- **Estimate vs. Invoice**: separate entities, but tied 1:1 to the event. Estimate signature → status flips to CONFIRMED. Invoice has a deposit-request sub-record with amount-or-percent + due-date; nightly auto-capture at 4am ET turns scheduled deposits into card charges.
- **Kitchen sheet**: derived view, not a stored entity. Generated from the event's order items + custom-fields filtered by `internal=true`. Operator picks which fields appear.
- **Multi-location**: every event belongs to one location; menus and tax rules are per-location but can be shared from a master. No cross-location event aggregation in the catering module — surprising gap.
- **Repeat customer**: keyed on email/phone in the customer directory shared with POS, so a catering customer who walks in to the restaurant is recognized in both surfaces.

Compared to our current Blu's KV schema (`inquiries:{threadId}` blob with deeply-nested everything), the Toast model is normalized — Event ↔ Estimate ↔ Invoice ↔ Deposit are separate records linked by event_id. For the SaaS pivot we should match that shape.

## E. Integration ecosystem

- **Payments**: Toast Payments only — no third-party processor option; the contractual lock-in is enforced.
- **Accounting**: QuickBooks Online, Xero, Restaurant365 (sales-summary export only; no AR/AP push for catering invoices).
- **Payroll**: Toast Payroll (first-party, $9/employee on bundled plans); Gusto, ADP, Paychex via partner API.
- **Delivery aggregators**: DoorDash Drive (built-in for catering delivery), Uber Direct, Relay; menu syncs one-way out.
- **Calendar**: Google Calendar two-way sync; no Outlook/Microsoft 365 native (must use Zapier).
- **Marketing/CRM**: Toast Marketing, Mailchimp, Constant Contact (one-way contact push).
- **E-signature**: built-in (type-name signature on estimates), no DocuSign integration — counts as a missing enterprise feature for venue operators.
- **API**: Toast has a partner API but it's gated by a partner agreement; no self-serve public API for arbitrary integrations. ~83 third-party connectors total per published numbers.

## F. Pricing model

- **Software**: tiered subscription per location.
  - Starter Kit: $0/mo software (offset by higher 3.09% + 15¢ processing rate)
  - Point of Sale: $69/mo per location
  - Build Your Own / Essentials / Custom: $165–$272+/mo per location
- **Catering & Events module**: ~$100/mo per location, on top of the POS subscription.
- **Catering & Events Pro** (adds EventView, Discussions, Tasks, Automations, Event Areas): higher tier, exact pricing not published — gated behind sales call.
- **Hardware**: proprietary Android-only. Terminals $799–$999, handhelds $627, kiosks $1,300, kitchen screens $499–$699. No iPad option, no BYO hardware. Hardware financing terms add interest.
- **Payment processing**: 2.49% + 15¢ card-present, 3.50% + 15¢ card-not-present. Toast contractually reserves the right to raise rates with 30 days notice.
- **Add-ons** that compound: Online Ordering ($75/mo), Marketing ($185/mo), each KDS screen ($35/mo), Loyalty (separate fee), SMS overages, $0.99 guest fee on online orders, $95/hr onboarding fees.
- **Real-world all-in**: operators on Reddit and Capterra report $1,000–$2,200/mo software-only at a single location once add-ons stack; first-year exposure including hardware and processing is $18k–$24k+.
- **Contract**: 2–3 year minimum with auto-renewal; ETF = remaining subscription balance or $150/mo × remaining months. No closure exemption.

## G. Anti-patterns (what NOT to copy)

1. **Long-term contracts with steep ETFs.** This is the single most-cited operator complaint across G2, Capterra, BBB, and Reddit. A bootstrapped Texas BBQ caterer who closes after 14 months on a 2-year contract owes $1,000+ for the privilege of leaving. For our SaaS pivot we should commit to month-to-month from day one and use that as a marketing wedge.
2. **Hardware lock-in via proprietary devices.** Cancel Toast and the $5k+ hardware bricks. We should be BYO-hardware (iPad, Chromebook, web) — the catering market is small operators who already own a phone/laptop.
3. **Mandatory payment processor.** No way to opt out. Toast can raise rates with 30 days notice. Our payment-provider abstraction in `api/payments/providers/` already encodes the right pattern; never break it for short-term margin.
4. **Hidden fees as standard practice.** Onboarding fees, chargeback fees, SMS overage, the $0.99 guest fee on online orders ("inflation fee" was their original branding before backlash). These erode trust and become Reddit-thread material. Keep our SaaS pricing legible.
5. **Catering & Events "Pro" gates basic operator needs.** Double-booking prevention (Event Areas) is a Pro-tier feature, not base. Discussions/in-app messaging is Pro. For a feature that prevents service failure, that's hostage pricing.
6. **No offline mode for catering.** When Toast's cloud goes down (317+ tracked outages since 2022; two 10+ hour outages in October 2026), catering operators lose access to their day-of BEOs. We should design BEO printout exports as the offline source of truth.
7. **Outsourced post-sale support.** Sales is responsive; tier-1 support is widely described as offshore and slow. For solo-operator customers this is fatal.
8. **Module sprawl with no bundle simplification.** Every feature is a separate SKU; quoting Toast for a new operator requires 4–6 line items. Our SaaS should bundle aggressively — one price, all features.

Sources:
- [Toast Catering & Events product page](https://pos.toasttab.com/products/catering-and-events)
- [Toast support: Getting Started with Catering & Events](https://support.toasttab.com/article/Getting-Started-Catering-and-Events)
- [Perfect Venue: Toast Catering & Events review](https://www.perfectvenue.com/post/toast-catering-and-events)
- [StartupOwl: Toast POS review 2026](https://startupowl.com/reviews/toast)
- [UpMenu: Toast pricing breakdown 2026](https://www.upmenu.com/blog/toast-pricing/)
- [Sleft Payments: Toast raised fees again 2026](https://www.sleftpayments.com/learning-hub/toast-pos-raised-fees-options-2026)
- [Korona POS: Toast cost calculator](https://koronapos.com/blog/toast-pos-cost-calculator/)
- [POS USA: Toast hands-on review](https://www.posusa.com/toast-pos-review/)
