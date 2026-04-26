# FreshBooks & Wave

> Combined dive on alternative invoicing UX. Each section is split into **FreshBooks** (premium service-business invoicing) and **Wave** (free-tier accounting/invoicing). Both are smaller, lighter-weight challengers to QBO and worth studying for what they keep and what they drop.

## A. Core value prop

**FreshBooks.** Invoicing-first accounting for service businesses (consultants, agencies, contractors). Where QBO is "the books," FreshBooks is "the client work" — proposals, time tracking, retainers, project profitability. Premium UX, hand-holdy onboarding, defensible niche among non-accountants who got burned by QBO's complexity.

**Wave.** Genuinely free accounting + invoicing for solo operators and freelancers — make money on payment processing (2.9% + $0.60) and a $19/mo Pro upsell for bank-feed automation. Value prop is "good enough" books for owners who would otherwise use a spreadsheet, with a hosted invoice payment page baked in.

## B. Top 5 features worth copying

**FreshBooks:**

1. **Retainers as a first-class object.** A retainer reserves "X hours or $Y of budget" for a client over a period; invoices burn down the balance. For catering this maps to "corporate client commits to $5K/quarter of meals" — a SaaS pivot feature, not an immediate Blu's need, but the data shape is worth modelling early (`retainer.balance_remaining`, `retainer.period_end`).
2. **Recurring template + auto-pull unbilled time/expenses.** Every cycle, the recurring invoice automatically scoops up time entries and expenses logged since last cycle. For Blu's: "weekly office lunch" recurring template that pulls in any extra delivery fees / late-add menu items logged that week.
3. **Proposals → estimate → invoice pipeline.** FreshBooks treats Proposal as a separate document type with e-sign acceptance, then converts to estimate, then to invoice. We collapse all three into "quote" today; the SaaS pivot likely needs the proposal/estimate split.
4. **Project profitability tracking (Premium tier).** Budget vs actual on a per-project basis. The catering analog: budgeted food cost % vs actual food cost %, surfaced per event. High value for ops decisions ("we lose money on weddings under 50 guests").
5. **Client portal with branded experience.** Customers log into a dedicated portal (white-labeled) showing all their invoices, estimates, and payment history. For repeat catering clients this is a strong retention tool — they don't have to dig through emails to find the PDF.

**Wave:**

1. **Free hosted payment page + free unlimited invoicing.** No subscription wall to send a professional invoice — only the processor takes a cut. This is the right "land" pricing for a free tier on the SaaS pivot.
2. **Late-payment reminders as a default-on automation.** 3 days before due / day-of / 7 days late, automatic. Cuts AR-chasing time materially. Implementation cost is low; just QStash schedule entries.
3. **Customer "paid" markup with one click.** If a customer pays by check or cash outside Wave, the operator clicks "Mark as paid" and enters `received_at` + optional `note`. Same shape we already have for `deposits:{threadId}` — just normalize it.
4. **Receipt scanning OCR (the "blurry photo" issue notwithstanding).** Forward an emailed receipt to a magic Wave address, ML extracts vendor/amount/date. Maps perfectly to our existing Gmail extraction pipeline — same idea, different document type.
5. **Tax categories on every line item.** Even on the free tier, each line carries a tax-rate selector. Simple but consequential — see Data Model section below.

## C. Notable UI patterns

**FreshBooks:** Clean, opinionated invoice templates (5–6 pre-built designs, not 50 like QBO). Color-and-logo customization is one screen. Progress bar at top of long flows. Mobile app is treated as first-class — half the customer base sends invoices from a phone. Time tracker has a giant single "Start timer" button on every project page.

**Wave:** Spartan dashboards, but the invoice editor is the cleanest of the four (FreshBooks/QBO/Square/Wave). Two columns (line items left, totals right), inline editing, no pop-up modals. Hosted payment page is mobile-first by default. Empty states are illustrated and helpful (not the QBO "0 results found" wall).

**Both:** Hosted payment landing page is a single CTA above the fold ("Pay $4,250") with line-item details collapsible below. No account creation required for the customer to pay — that friction kills conversion and both products know it.

## D. Data model insights — what we're missing

Common shape across both:

```
Customer { id, name, email, phone, billing_address, currency, default_terms, tax_id }
Invoice { id, customer_id, status, line_items[], subtotal, tax_total, total,
          paid_amount, balance_due, due_date, sent_at, viewed_at, paid_at }
LineItem { description, quantity, unit_price, tax_rate, tax_inclusive: bool, line_total }
Payment { id, invoice_id, amount, method, received_at, processor_txn_id, fee_amount }
RecurringTemplate { id, customer_id, frequency, next_run, line_items[], active }
Retainer (FreshBooks) { id, customer_id, period_start, period_end, allocated_hours,
                        allocated_amount, balance_remaining }
```

Gaps in our current `inquiries:{threadId}` + `deposits:{threadId}` shape:

- **`viewed_at` / `sent_at` timestamps** on the invoice document itself. Wave shows the operator "your customer opened this invoice 2 days ago" — gold for follow-up timing. Implementable via a tracking pixel or unique link redirect.
- **`tax_rate` per line item, plus `tax_inclusive` boolean.** Today our tax is computed at the quote total level. Per-line tax lets us mix taxable food, taxable alcohol, and tax-exempt service charges (where applicable in TX) on the same invoice.
- **`fee_amount` on every payment record.** When Stripe takes 2.9% + $0.30, store the fee separately so net-deposited amount and gross-charged amount are both queryable. Critical for accurate reporting.
- **`due_date` as first-class field on quote/invoice.** Today our event-date implies the deposit/balance schedule; we need explicit `deposit_due_date` and `balance_due_date` so reminders and aging reports work.
- **`recurring_template_id` foreign key on invoice.** When an invoice was generated by a template, link back so we can answer "show me all invoices from the Tuesday-lunch standing order."
- **`customer.tax_exempt_certificate_url`.** PDF upload of the Texas resale/exemption cert with `expires_at` — reminded annually. Today this is buried in email threads.

## E. Integration ecosystem

**FreshBooks:** ~100 integrations — Stripe, PayPal (built-in payments), Gusto (payroll), G Suite, Asana, Slack, Trello, Zapier. Direct bank feeds via Plaid.

**Wave:** Deliberately small ecosystem — Zapier, Etsy, PayPal. No native marketplace. 2025 controversy: bank-feed integrations moved from free to Pro ($19/mo), provoking long-time users.

Both have public REST APIs. FreshBooks API is documented and stable; Wave's API was deprecated for new sign-ups in 2024 (read-only public access removed) — a cautionary tale about building on top of a free-tier vendor's API.

## F. Pricing model

**FreshBooks (2025 retail; 70% promo discount common):**

| Tier | Monthly | Clients | Notable |
|---|---|---|---|
| Lite | $23 | 5 | No e-sign, no proposals |
| Plus | $43 | 50 | Adds e-sign, retainers, double-entry |
| Premium | $70 | unlimited | Email automation, project profitability |
| Select | custom | unlimited | Lower processing fees, white-label |

Payment processing: 2.9% + $0.30 standard; lower on Select tier; ACH 1% (capped).

**Wave (2025):**

| Tier | Monthly | Notable |
|---|---|---|
| Starter | $0 | Unlimited invoicing, no bank feeds, no receipt scan |
| Pro | $19 ($16 annual) | Bank feeds, branded invoices, receipt scan, late-payment reminders |
| Advisors | $199+ | Bookkeeper service |

Payment processing: 2.9% + $0.60 (Visa/MC/Disc), 3.4% + $0.60 (Amex), ACH 1% ($1 minimum). Pro tier waives the $0.60 per-tx fee on first 10 transactions/month.

**Takeaway for SaaS pivot pricing:** Wave proves the "free tier + processor margin" model works at scale (small operators happily pay 2.9% to send a free invoice). FreshBooks proves the "premium tier with project profitability" model captures higher-LTV niches. The right play is probably both — free tier to acquire, premium tier to monetize.

## G. Anti-patterns

**FreshBooks:**

1. **Per-client billing limits.** Lite cap of 5 billable clients pushes operators to upgrade as soon as they grow — but the cap is opaque (you don't realize until you can't add the 6th client). Better: usage-based pricing or a clear in-app upgrade nag at 4 clients.
2. **Time-tracker upsell fatigue.** Free time tracker entry is gated behind in-flow upsells for project profitability and retainers; users complain about the modal frequency.
3. **Aggressive promotional pricing.** "$23/mo, 70% off!" — actual price after 4 months is $77/mo Plus tier, surprising operators on the renewal bill. Use plain-honest pricing.

**Wave:**

1. **Pulling features behind a paywall after years of "free."** The 2025 move of automatic bank imports from free to Pro ($19/mo) is the most-cited grievance in 2025–2026 reviews. Long-term lesson: when something has been free for years, *grandfather* existing users into the legacy tier rather than force-migrate.
2. **No customer support on the free tier.** "Stuck talking to a bot for three days" is the recurring Trustpilot complaint. The economics of free-tier support are hard, but at minimum a self-serve KB + community forum is mandatory.
3. **Accrual-only accounting, no cash-basis option.** Solo operators almost always want cash-basis; Wave's lack of a toggle means they outgrow the product faster than they should.
4. **API deprecated for new builds.** Friction for ecosystem partners; signals a product that's been milked rather than invested in.
5. **Receipt-scan OCR quality issues.** Unreliable extraction → manual re-entry → users abandon the feature → it doesn't earn the data flywheel it needs to improve. Lesson for our own ML extraction: invest in quality before shipping at scale.

Sources:
- [FreshBooks pricing](https://www.freshbooks.com/pricing)
- [FreshBooks recurring templates / retainers](https://support.freshbooks.com/hc/en-us/sections/205041867-Recurring-Templates-and-Retainers)
- [FreshBooks 2025 review](https://invoicemojo.com/reviews/freshbooks/)
- [Wave pricing](https://www.waveapps.com/pricing)
- [Wave 2026 NerdWallet review](https://www.nerdwallet.com/business/software/reviews/wave-accounting)
- [Wave 2025 review — Wise](https://wise.com/us/blog/wave-accounting-review)
- [Wave Trustpilot reviews](https://www.trustpilot.com/review/waveapps.com)
