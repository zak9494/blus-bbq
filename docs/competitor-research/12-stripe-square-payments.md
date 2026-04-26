# Stripe & Square (Payments)

> Combined dive on the two payment processors most relevant for a catering ops tool. Each section is split into **Stripe** (developer-first, programmatic) and **Square** (operator-first, hosted UX). We already have a payment-provider abstraction stub; this research informs which surface to wire first and what data shape to standardize on.

## A. Core value prop

**Stripe.** Programmable money infrastructure: PaymentIntents, Subscriptions, Invoicing, Tax, Connect (marketplace), Issuing (cards), Treasury (banking). Built for engineers — every concept has an API, every state has a webhook, every error has a code. The hosted "Payment Links" and "Hosted Invoice" surfaces are the no-code escape hatches but the meat is the API.

**Square.** Operator-first commerce platform: POS, Invoicing, Online Store, Appointments, Payroll. The free Invoicing tier is the relevant slice — unlimited invoices, deposits, milestone payments, recurring schedules, all with a nice operator UI and a hosted customer payment page. Square owns the experience top-to-bottom; you pay for that with less customization than Stripe.

## B. Top 5 features worth copying

**Stripe:**

1. **PaymentIntent with `capture_method: 'manual'`.** Authorize a card up to 7 days before charging it. For catering: capture a card at quote-acceptance, charge the deposit immediately, hold the balance for event-day. This is *the* primitive for catering deposits and we should design our payments adapter around it from day one.
2. **Hosted Invoice page + email-to-pay.** Stripe Invoicing renders a hosted invoice URL; one link, customer pays without account creation, status flows back via webhook. Replaces our current "PDF attached → manual deposit recording" loop with "PDF attached → click → paid → KV updated automatically."
3. **Customer Portal.** Pre-built, hosted, branded — customers self-manage subscriptions, update payment methods, view invoice history. Zero engineering on our side. Ship this for repeat customers immediately; saves us from building it.
4. **Smart Disputes auto-evidence.** Stripe auto-assembles evidence packets (invoice, customer email, signed quote) and submits them just before the dispute deadline if the operator does nothing. Reduces chargeback losses for solo operators who can't watch dashboards daily.
5. **Webhooks for every state transition.** `payment_intent.succeeded`, `charge.dispute.created`, `invoice.payment_failed`, `customer.subscription.updated` etc. all push to our backend. We already have webhook plumbing for QStash and Calendar; extending to Stripe events is mechanical.

**Square:**

1. **Deposit + milestone schedule on a single invoice (free tier).** First-class deposit field (% or $) plus up to 12 follow-up milestones. We model this manually today — Square's UI and data shape is the reference design.
2. **"Save card on file" checkbox on the hosted page.** One-tap consent at checkout; future invoices to that customer can auto-charge with a single click from the operator dashboard. Critical for the "balance due on event date" pattern — operator never has to chase the balance.
3. **Invoice expiry + self-service link refresh.** Payment links expire (security best practice). When expired, the customer can request a new link from the expired-page itself — no operator intervention. We should adopt this for our quote PDFs: short-lived signed URLs with self-serve refresh.
4. **Auto-payment reminders (free tier).** Pre-due, day-of, post-due reminders configurable per invoice. Built into the product, not an upsell. We can implement equivalent today with QStash.
5. **`Invoice.viewed` webhook.** Square pushes an event when the customer first views the invoice — operator gets a "your customer just opened the invoice" signal that's perfect for nudging conversion. We should add equivalent tracking.

## C. Notable UI patterns

**Stripe:**

- **Hosted Invoice page** — minimalist, single CTA, brand-customizable (logo, color), mobile-first. Line items collapse below the total on mobile.
- **Payment Links dashboard** — table of links with click count, conversion rate, total collected per link. Useful for A/B-testing which messaging gets paid faster.
- **Dispute evidence workflow** — guided form prompts for the relevant evidence per reason code (e.g., "fraud" asks for IP logs; "service not received" asks for delivery confirmation). We could mirror this pattern when we ask the operator to gather receipts post-event.
- **Stripe Tax inline in checkout** — tax shown as a line item that updates live as the customer enters their ZIP, no page refresh.
- **Customer Portal** — single-page app, zero learning curve, Stripe-branded but logo/color customizable.

**Square:**

- **Operator invoice editor** — line-item table on left, totals + deposit + milestone schedule sidebar on right. Toggle switches for "Request Deposit" and "Split Balance into milestones" feel like physical hardware buttons.
- **Customer hosted payment page** — single-screen mobile-first flow, "Pay $4,250" hero, line items below, payment method picker (card / Apple Pay / Google Pay / ACH) as horizontal tiles.
- **"Text us" button** on the customer-facing invoice — direct SMS to the operator from inside the invoice page. This is *exactly* the catering pattern (last-minute questions before paying) and we should ship it tied to our existing `sms_channel` flag.
- **Project workspace** — invoices, estimates, contracts, communications all bundled per "project" (read: per event). Maps to our `inquiries:{threadId}`; we should rename to `event` or `project` for the SaaS pivot.

## D. Data model insights — what we're missing

**Stripe PaymentIntent** (the canonical reference shape):

```
PaymentIntent {
  id, amount, amount_capturable, amount_received, currency,
  capture_method: 'automatic' | 'automatic_async' | 'manual',
  confirmation_method: 'automatic' | 'manual',
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action'
        | 'processing' | 'requires_capture' | 'canceled' | 'succeeded',
  customer, payment_method, latest_charge,
  application_fee_amount, last_payment_error,
  metadata, statement_descriptor, setup_future_usage
}
Charge { id, payment_intent_id, amount, refunded, refunds[], dispute }
Refund { id, charge_id, amount, reason, status, balance_transaction }
Dispute { id, charge_id, amount, reason, status, evidence{...}, evidence_due_by }
Invoice { id, customer, status: 'draft'|'open'|'paid'|'void'|'uncollectible',
          lines[], subtotal, tax, total, amount_paid, amount_due,
          hosted_invoice_url, invoice_pdf, payment_intent }
```

Gaps in our current schema (`inquiries:{threadId}`, `deposits:{threadId}`, `quote`):

| Stripe concept | Our schema | Gap to close |
|---|---|---|
| `PaymentIntent.amount_capturable` | none | Track authorized-but-not-yet-captured (the held balance for event day) |
| `PaymentIntent.capture_method` | implicit "charge now" | First-class field; required for deposit + balance pattern |
| `PaymentIntent.status` enum | `deposit.status` is loose | Adopt Stripe's 7-state machine wholesale; cleanest available |
| `Charge.refunded` + `Refund[]` | none | Refund is a missing entity entirely; needed for cancellations |
| `Dispute` entity | none | Required when SaaS scales; webhook hooks for evidence auto-pull |
| `Invoice.hosted_invoice_url` | we email a PDF | Add a hosted quote/invoice URL flow, not just attached PDF |
| `Invoice.amount_due` | derived | Persist for fast queries / dashboards |
| `Invoice.tax` (per-line tax_rate.id) | global tax flag | Per-line tax with tax-rate FK |
| `payment_method` (saved card token) | none | Saving card-on-file is the entire balance-due pattern |
| `setup_future_usage: 'off_session'` | n/a | Token persistence consent for later auto-charge |
| `metadata` (JSON kv on every record) | partial | Make this universal; lets us tag every record with `threadId`, `event_id`, `inquiry_source` |
| `application_fee_amount` | n/a | When SaaS pivot adds Connect (multi-tenant payouts), this is the platform-take field |

**Square Invoice deposit shape (reference):**

```
Invoice {
  id, status, primary_recipient,
  payment_requests: [
    { uid, request_type: 'BALANCE'|'DEPOSIT', due_date,
      percentage_requested?, fixed_amount_requested?, tipping_enabled,
      automatic_payment_source, reminders[] }
  ],
  delivery_method, accepted_payment_methods, custom_fields[]
}
```

The `payment_requests[]` array model is elegant — one invoice, many payment requests, each with its own due date and reminders. Adopt this shape.

## E. Integration ecosystem

**Stripe:** 600+ integrations — every accounting tool (QBO, Xero, FreshBooks, Wave) imports Stripe data; Zapier, Make, n8n; webhooks consumable by anything. Stripe Connect lets *your* SaaS embed payments for *your* tenants — the SaaS pivot's killer feature.

**Square:** Tighter ecosystem — POS, online store, appointments, payroll, banking are all Square-native. Third-party integrations via API + Zapier. QBO sync exists but is one-way and lossy.

For our use case:
- **Use Stripe** for the developer-flexible path (custom hosted invoice, our own UI, programmatic deposit/balance flow, future SaaS Connect).
- **Use Square** as the second adapter for operators who already have Square POS at the BBQ counter (the data follows them).
- Our existing payment-provider abstraction (`api/payments/providers/`) is correctly designed for this both-and approach.

## F. Pricing model

**Stripe (2025):**

| Product | Fee |
|---|---|
| Standard cards | 2.9% + $0.30 |
| ACH | 0.8% (capped at $5) |
| Payment Links / Checkout | included in card fee |
| Stripe Billing Starter | +0.5% on recurring charges |
| Stripe Billing Scale | +0.8% on recurring + advanced features |
| Stripe Invoicing Starter | +0.4% per paid invoice (cap $2) |
| Stripe Tax Basic | per-transaction (~0.5% or 5¢/calc above 10) |
| Disputes | $15 per dispute (refunded if won) |
| Custom domains for Payment Links | +$10/mo |

**Square (2025):**

| Product | Fee |
|---|---|
| Invoiced card | 2.9% + $0.30 |
| Card-on-file invoice | 3.5% + $0.15 |
| In-person swipe | 2.6% + $0.10 |
| Keyed-in | 3.5% + $0.15 |
| ACH bank transfer | 1% (Plus tier caps at $10/tx) |
| Square Invoices Plus | $20/mo (adds milestones, custom templates) |
| Square Invoices Premium | $40/mo (lowest processing fees, 24/7 phone) |
| Disputes | no fee, just chargeback amount |

**SaaS billing recommendation (for the pivot):** Stripe Billing's 0.5% on top of standard 2.9% + $0.30 means a $99/mo subscription costs the SaaS ~$3.40 in payment fees. Stripe Billing's Customer Portal alone saves 4–6 weeks of build. Use it. Disputes are $15 each on Stripe — negligible at single-tenant scale, material at multi-tenant scale; Smart Disputes pays for itself once you cross ~50 active operators.

## G. Anti-patterns

**Stripe:**

1. **API-first to a fault.** Without engineering, Stripe is hostile — operators can't easily customize the hosted invoice page beyond logo/color, and "no-code" Payment Links are stripped-down. Fine for us (we have engineering), but if SaaS-pivot operators expect a Square-grade UI we have to build it.
2. **Pricing complexity stack.** Card 2.9% + Billing 0.5% + Invoicing 0.4% + Tax variable + dispute $15 + custom domain $10 — operators get nasty surprise on the monthly statement. When we surface costs to our operators, show **all-in effective rate**, not the headline.
3. **Multicapture restrictions for deposit workflows.** Stripe explicitly notes some card networks don't permit multicapture for "installment or deposit workflows." Test this for our use case before designing around it; we may need two separate PaymentIntents (one for deposit, one for balance) instead of one with multiple captures.
4. **7-day authorization window.** Manual capture only holds funds 7 days for online cards — our catering window is often 30–60 days from quote to event. Plan accordingly: charge deposit immediately, then create a *new* PaymentIntent for the balance closer to event day using the saved payment method.
5. **Webhook reliability requires idempotency.** Stripe retries webhooks; if our handler isn't idempotent, we double-record deposits. We have webhook handlers for QStash already; the same idempotency-key discipline applies to Stripe.

**Square:**

1. **Reporting dark patterns.** Deposits and partial payments don't appear in transaction reports until the invoice is fully paid — operators get confused when funds show in Balances but not in reports. Our internal reporting should always reflect actual cash received in real time.
2. **Card-on-file fee jump.** 3.5% + $0.15 for card-on-file vs 2.9% + $0.30 for first invoice — economics flip on transaction size, and operators don't realize. When we save a card on file, surface the next-charge fee preview.
3. **Plus/Premium feature gating.** Milestone payments and custom templates are paywalled at $20/mo Plus tier despite the "free invoicing" branding. Be careful when our marketing says "free" — make the limits visible upfront.
4. **API depth lags Stripe materially.** If we standardize on Stripe-shaped abstractions, the Square adapter will have to fake some behaviors (e.g., manual capture support is more limited).
5. **POS-first mental model.** Square assumes you have a counter and a cash drawer. Catering is mostly delivery + invoicing — the POS-centric reports and dashboards are noise for our use case.

Sources:
- [Stripe Billing](https://stripe.com/billing) and [Billing pricing](https://stripe.com/billing/pricing)
- [Stripe Payment Links](https://stripe.com/payments/payment-links)
- [Stripe PaymentIntent API](https://docs.stripe.com/api/payment_intents/object)
- [Stripe — place a hold on a payment method](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)
- [Stripe Multicapture](https://docs.stripe.com/payments/multicapture)
- [Stripe Disputes](https://docs.stripe.com/disputes/responding) and [Smart Disputes](https://docs.stripe.com/disputes/smart-disputes)
- [Stripe Tax pricing](https://stripe.com/tax/pricing)
- [Stripe Invoicing pricing](https://support.stripe.com/questions/stripe-invoicing-pricing)
- [Stripe Invoicing data model](https://docs.stripe.com/invoicing/overview)
- [Square Invoices pricing](https://squareup.com/us/en/invoices/pricing)
- [Square deposits + milestones](https://square.site/help/us/en/article/6581-request-deposits-with-square-invoices)
- [Square Invoice API object](https://developer.squareup.com/reference/square/objects/Invoice)
- [Square Fees 2025 (Swipesum breakdown)](https://www.swipesum.com/insights/square-fees-explained-understanding-your-payment-costs)
