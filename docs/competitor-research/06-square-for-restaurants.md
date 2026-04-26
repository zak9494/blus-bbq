# Square for Restaurants

Research date: 2026-04-25.

## A. Core value prop

Square for Restaurants is the food-service vertical of the broader Square POS — a generalist payments-first platform that has been progressively layered with restaurant-specific features (course management, KDS routing, online ordering). Strongest at small operators, food trucks, takeout-heavy restaurants, and SMBs that already have a Square account; weakest at full venue/event operations because catering is treated as an estimate-and-invoice flow rather than a first-class object.

## B. Top 5 features worth copying

1. **Free tier with a real catering on-ramp.** The free plan includes a branded online-ordering page and Square Invoices with deposit support. For a solo BBQ operator this is the closest thing to "no-fee onboard until you have revenue" in the market — that's the right bootstrap-friendly defaults to mirror.
2. **Estimates + invoices with automatic payment reminders, ACH, and partial deposits.** Every catering inquiry can become an estimate, then an invoice, with a reminder cadence built in. Our existing `api/quotes/` flow plus `deposits/save.js` should model this same Estimate → Invoice → Deposit lifecycle and produce the same auto-reminder behavior.
3. **Unified order dashboard.** In-house orders, online orders, delivery aggregators (DoorDash/UberEats), QR-code orders, and third-party orders all flow into a single screen. For a caterer also doing some retail/family-pack sales, "all orders one place" is a strong pattern.
4. **Customer Directory with cross-channel purchase history.** A walk-in customer who later books a catering order is automatically recognized; lifetime spend is tracked across both surfaces. We have a `repeat-customer` module already — extending it to cross-channel (email + future SMS + future POS) is the natural evolution.
5. **Menu-to-ingredient vendor cost comparison.** Lets operators flag when Sysco vs. Restaurant Depot is cheaper for the same SKU. Niche but high-value for a BBQ operator pricing brisket, and a credible upsell tier in a SaaS pivot.

## C. Notable UI patterns

- **Tab-bar-first navigation on iPad.** Unlike Toast's calendar-first layout, Square is order-list-first. Bottom tab bar (Orders / Items / Reports / Customers / More) — same as Square retail. Trades off catering-specific affordances for cross-vertical familiarity.
- **Photo-driven menu builder.** The item editor leads with a square image upload. The KDS view also leans on photos. For a BBQ catering menu, photo-first item cards make customer-facing menus look competent without designer involvement.
- **Invoice composer is essentially a Google-Doc-like editor** — line items inline, drag to reorder, click-to-add, with a live-preview right rail showing the customer view. This is the right "one screen, two columns" pattern for a quote-builder.
- **Square Dashboard is web-first; the POS is iPad-native.** Both share the same green/white visual language. Easy to clone — neutral whitespace, single accent color, sans-serif body.
- **Customer profile screen merges contact, purchase history, loyalty, and feedback into one scrollable page** with collapsible sections. Better than the disjointed multi-tab pattern Toast and most CRMs use.

## D. Data model insights

- **Order**: the central entity. A "catering order" is just an Order with a `fulfillment_type=delivery|pickup` and a `scheduled_at` future timestamp. No dedicated Event entity. This is a meaningful gap — multi-day events, BEOs, and timeline-driven prep can't be modeled cleanly.
- **Estimate / Invoice**: separate top-level entities, both tied to a Customer. Invoices support recurring schedules (good for retainer caterers), partial payments, ACH, and automated reminders.
- **Customer Directory**: cross-channel; one customer record across in-store, online, catering, and loyalty. Includes `groups` (segments) for marketing.
- **Items / Variations / Modifiers / Modifier Lists**: standard POS hierarchy. Modifiers can be required or optional, single or multi-select. Tax rules attach at item or category level with location override.
- **Locations**: every item, order, and tax rule scopes to a location. Multi-location data is queryable centrally but settings live per location.
- **Tax rules**: per-location, per-item-category, with customer-level tax-exempt flag (good for non-profit/church catering) and per-order override.
- **Deposit/payments**: every payment is a Square Payment row keyed to an order or invoice. Supports save-card-for-later, recurring, ACH bank debit, and Cash App Pay.
- **No native BEO concept.** No event areas / capacity blocking. No kitchen-prep aggregation across multiple events on the same day. Caterers using Square invariably bolt on a third-party (Curate, TPP) for BEO/event management.

## E. Integration ecosystem

- **Payments**: Square Payments only at the POS layer; for invoices, Square processes ACH, cards, Cash App, Apple/Google Pay. Like Toast, processor lock-in.
- **Accounting**: QuickBooks Online, Xero, Wave, Zoho Books — better accounting coverage than Toast.
- **Payroll**: Square Payroll (first-party, $35/mo + $6/employee — meaningfully cheaper than Toast Payroll).
- **Delivery**: DoorDash, Uber Eats, Postmates, Grubhub via Square Online; Square also offers on-demand delivery via DoorDash Drive at flat per-order fees.
- **Online ordering**: native Square Online (free site builder), plus integrations with ChowNow, BentoBox, Slice (pizza), Olo (limited).
- **Reservations**: OpenTable, Resy, Tock — partner integrations.
- **Catering software**: integrates with Tripleseat (event management) — explicit acknowledgment that Square doesn't do BEOs.
- **Marketing**: Square Marketing (first-party, email + SMS), Mailchimp, Klaviyo.
- **API**: rich public API and webhooks. Free, self-serve developer accounts. Best-in-class for a generalist platform — much more open than Toast.

## F. Pricing model

- **Free plan**: $0/mo software, 2.6% + 10¢ in-person, 2.9% + 30¢ online/keyed. Includes online ordering page, basic POS, invoices with deposits.
- **Plus plan**: $69/mo per location. Adds course management, advanced KDS routing, advanced reporting, custom permissions.
- **Premium plan**: $165/mo per location. Adds custom rates for high-volume processing ($250k+/yr), priority support.
- **Hardware**: NOT proprietary. iPad-based or Square Stand ($149), Square Terminal ($299), Square Register ($799). BYO iPad supported. Resale value is real.
- **Processing**: 2.6% + 10¢ in-person standard; ACH 1% capped at $10/transaction (good for big catering deposits); Invoices 3.3% + 30¢; Online 2.9% + 30¢. Invoice ACH at 1% is a notable cost advantage for catering deposits.
- **No long-term contract.** Month-to-month. No ETF. This is the differentiator — and the marketing wedge a SaaS pivot should adopt.
- **Catering-specific add-on**: none. Catering is treated as a use case of base features, not a paid module.

## G. Anti-patterns

1. **No catering-native data model.** Pretending a catering order is "just a future-scheduled order" makes everything past basic estimate-and-deliver hard: no BEOs, no event timeline, no station-based prep aggregation, no double-booking prevention, no equipment list, no staff assignment. Caterers grow out of Square fast.
2. **Customer support is famously thin.** Square is self-serve by design; phone support exists but reviewers consistently report long waits and email-first replies. For catering ops where a missing payment on Friday afternoon is a disaster, this is risky.
3. **Sudden account holds / fund freezes.** Long-running operator complaint across Reddit and BBB — Square's risk algorithms occasionally freeze deposits with little notice, especially after a large invoice payment (a $10k catering deposit looks like fraud to a model trained on $20 coffee tickets). Caterers report 30–90 day fund holds.
4. **Online ordering page UX is generic.** Square Online templates are fine for retail but feel thin for premium catering. No event-inquiry form, no "request a quote" flow. Forces caterers to bolt on a Typeform or Jotform.
5. **Modifier model breaks down on catering scale.** Square modifiers were designed for "extra cheese" not "16 pans of brisket, half sliced / half chopped, with these three sides and this side of sauce." Operators end up creating dozens of items to compensate.
6. **Invoice cap on line items / attachments.** Square Invoices truncate beyond a certain line-item count and don't support arbitrary attachments well — a 40-line BEO with PDFs gets ugly.
7. **No native e-signature on estimates.** Customers can "accept" an estimate with a button click, but there's no typed-name or drawn-signature artifact stored. For deposit-protected events, that matters.

Sources:
- [Square for Restaurants product page](https://squareup.com/us/en/restaurants)
- [Square for Restaurants capabilities](https://squareup.com/us/en/restaurants/capabilities)
- [NerdWallet: Square for Restaurants review 2026](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants)
- [GetApp: Square for Restaurants 2026](https://www.getapp.com/retail-consumer-services-software/a/square-for-restaurants/)
- [POS USA: Square for Restaurants review](https://www.posusa.com/square-for-restaurants-review/)
- [UpMenu: Square pricing breakdown 2026](https://www.upmenu.com/blog/square-pricing/)
