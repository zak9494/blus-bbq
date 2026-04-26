# QuickBooks (Online + Self-Employed)

> Deep dive — invoicing, recurring billing, payment links, sales reporting, tax handling, and sales-tax automation. QuickBooks Online (QBO) is the de-facto SMB accounting platform; understanding its surface area maps the "table stakes" any catering ops SaaS will be measured against.

## A. Core value prop

QuickBooks is the small-business "general ledger + invoicing + payments" hub: a single product that books the journal entry, sends the invoice, accepts the card payment, calculates sales tax by jurisdiction, and produces the P&L / 1099 / Schedule C the owner hands to their CPA. Its moat is accountant-side network effects (every CPA already speaks QBO) more than UX quality.

## B. Top 5 features worth copying

1. **Progress invoicing from a single estimate.** QBO lets you generate multiple partial invoices off one estimate — "25% deposit / 50% mid-project / 25% on completion" — and the report view tracks "% invoiced / % remaining" against the estimate. This is exactly the catering deposit pattern (50% upfront / balance on event date) and we should model our quote → invoice schedule on this. The estimate stays the source of truth; invoices are children that consume budget.
2. **Automated sales tax by location + product class.** QBO's Automated Sales Tax (AST) computes the correct rate from (ship-to address, customer tax status, product tax code, transaction date). For Texas at 8.25% the rate is rarely controversial, but the *exemption* path (non-profits, churches, government) is — copy the per-customer `tax_status` field and per-line-item `tax_code` so the engine can mark a quote tax-exempt without manual math.
3. **Estimates & Progress Invoicing Summary report.** A single report shows every open estimate with status, amount invoiced, percentage invoiced, and balance remaining. We already have a kanban; a "money-flow" companion view (committed quote $, invoiced $, collected $, outstanding $) would be high-leverage for a solo operator's weekly cash check.
4. **Recurring invoice templates.** Same template, send on a schedule, auto-fill any unbilled time/expense lines accumulated since last cycle. For catering this is corporate-lunch / weekly-meal-prep / standing-order use cases — useful for the SaaS pivot to retain repeat clients.
5. **"Deposit" field on invoice that subtracts from balance due.** A first-class field on the invoice document (not a separate side-table) that shows the deposit applied and balance owed on the same printable PDF. Customers don't have to mentally subtract — the document is self-explanatory. We should add `deposit_applied` and `balance_due` as derived fields on our quote/invoice render.

## C. Notable UI patterns

- **Hosted invoice page** — customer clicks "Review and pay" link in email, lands on a QuickBooks-branded page showing line items, subtotal, tax, deposit applied, balance due, and a single "Pay invoice" CTA. Card / ACH / Apple Pay are pickers, not separate flows.
- **Estimate → Invoice converter** — one-click "Create invoice from estimate" with a modal asking "Remaining total, % of each line, custom amount per line" — three radio options that cover 90% of progress-billing patterns.
- **Customer detail page** — single timeline showing all estimates, invoices, payments, credits per customer; balance owed is a single number at top. We have a "by-email" lookup but no aggregated view.
- **Sales tax liability report** — pre-built "what you owe each jurisdiction this period" that maps to the actual filing form. Solo operators love this because it eliminates the "is this number right" anxiety on the 20th of each month.
- **Mobile invoice send-from-phone** — one-thumb workflow: pick customer → pick line items from a saved catalog → send. We should keep this as our north star for the mobile inquiry-to-invoice path.

## D. Data model insights — what we're missing

QBO entities (simplified): `Customer`, `Estimate`, `Invoice` (with `LineItem[]`, each line carrying `tax_code` + `taxable` flag), `Payment` (1-to-many against invoices via `applied_to[]`), `Deposit` (separate from Payment), `Refund`, `CreditMemo`, `SalesReceipt`. Key takeaways for our schema:

| QBO concept | Our schema today | Gap |
|---|---|---|
| `LineItem.tax_code` | quote items have a single global `taxExempt` boolean | Per-line tax control (alcohol vs food vs service charge can be taxed differently in TX) |
| `Invoice.balance_due` (derived) | computed at render time | Persist `balance_due` so reports/queries don't recalculate |
| `Payment.applied_to[]` (array of {invoice_id, amount}) | `deposits:{threadId}` is a flat array | Need an explicit join — one payment may apply to multiple invoices, one invoice may receive many payments |
| `CreditMemo` (negative invoice) | none | When a customer overpays, cancels, or you comp them — needs first-class entity, not a "negative deposit" hack |
| `Refund` (with reason code, original payment FK) | none | Required for chargebacks and customer-cancellation refunds |
| `Estimate.status` enum (`pending`, `accepted`, `closed`, `rejected`) | `inquiry.status` only | Estimate-level state machine separate from inquiry state |
| `tax_summary` on invoice (per-jurisdiction breakdown) | single `tax` total | TX is one jurisdiction now; SaaS pivot will eventually need multi-state |
| `customer.default_terms` (Net 30, Due on receipt) | none | Catering is mostly "due on event date" but corporate clients want net terms |
| `currency` on every monetary record | implicit USD | Cheap to add now, painful to retrofit |
| `discount` line type (% or $, before/after tax) | none | Frequent ask: "20% off for repeat customer" |

## E. Integration ecosystem

QBO Apps marketplace has ~750 integrations. The relevant ones for a catering ops SaaS:

- **Bank feeds** — Plaid-style automatic transaction import; deposits in your business checking auto-match invoices marked "paid by check/ACH"
- **Payroll** — QuickBooks Payroll (in-house) and Gusto integration; relevant once Blu's hires staff
- **CRM** — HubSpot, Salesforce sync customers + invoices both directions
- **Calendar** — direct Google Calendar / Outlook sync for time-tracked invoices
- **E-commerce** — Shopify, Square POS, WooCommerce push orders into QBO as sales receipts
- **Payment processors** — QuickBooks Payments (in-house) is default; Stripe/Square/Authorize.net via apps. Important: QuickBooks Payments is the only one with native "fees auto-recorded as expense" — third-party processors require a manual journal entry, which is a friction point we could exploit by being native-first.
- **Tax filing** — Avalara, TaxJar, DAVO ($57/mo) handle filing remittance; QBO computes but doesn't file

## F. Pricing model

QBO subscription tiers (2025/2026 retail; 50–70% promotional discounts common for first 3 months):

| Tier | Monthly | Users | Notable cap |
|---|---|---|---|
| Simple Start | $35 | 1 | No bills, no time tracking |
| Essentials | $65 | 3 | Adds bills, multi-currency, time tracking |
| Plus | $99 | 5 | **Adds Progress Invoicing, inventory, 1099 contractors** |
| Advanced | $235 | 25 | Custom roles, batch invoicing, dedicated CSM |

QuickBooks Payments (transaction fees, 2025):
- **Swiped card:** 2.4% + $0.25
- **Invoiced card (online):** 2.9% + $0.25
- **Keyed card:** 3.4% + $0.25
- **ACH:** 1% (capped at $10; raised to $20 in March 2025 for invoices $1–$1,999)
- **Instant deposit:** 1.75% extra for same-day funding

QuickBooks Self-Employed: $20/month; basic Schedule C tracking, no invoicing depth — being deprecated/folded into QBO Solopreneur tier.

## G. Anti-patterns — what NOT to copy

QBO carries enormous UX debt, well-documented by enraged user threads:

1. **Page-load latency is unforgivable.** Users report 10–20 seconds to load the home page, 2–3 seconds per click in bank feeds, page-unresponsive errors during transaction matching. This is the single most-cited complaint on the QuickBooks Community forum and Reddit r/Accounting. We should keep our single-page architecture and *not* go multi-page-app.
2. **Invoices forced into separate full-page documents.** Modern QBO removed inline invoice editing — every action opens a new full page that has to load. We should keep edits inline and modal-first.
3. **Burying common actions 3+ clicks deep.** Users complain that creating a payment, applying a credit, or splitting an invoice now takes "three layers of menu diving" where the legacy desktop product was one click. Our pipeline kanban already has this right (open card → all actions visible) — protect it.
4. **Mandatory new UI without rollback.** When QBO shipped a new invoice form in 2024, users had no opt-out. Hundreds of community threads asked for the legacy view. Lesson: when we redesign, gate behind a flag with explicit user opt-in for ~6 months.
5. **Convenience-fee land mines.** The new $25 ACH "convenience fee" auto-applies in some account configurations without owner consent and shows up on the customer's invoice. This is the kind of opaque processor-fee behavior that gets a SaaS sued — never auto-add fees the operator hasn't approved.
6. **Customer support cliff.** Multi-hour holds, scripted bot answers, no escalation. Both an opportunity (be reachable) and a warning (don't grow the product faster than the support model can handle).
7. **Dashboard redesigns that drop fields.** The 2025 dashboard refresh removed Accepted Date, Accepted By, Territory, Internal Note, and Order Number from the mobile invoice view — months of community outcry, no rollback. Lesson: ship redesigns additively, never delete fields silently.

Sources:
- [QuickBooks Online Pricing](https://quickbooks.intuit.com/pricing/)
- [QuickBooks Payments rates](https://quickbooks.intuit.com/payments/payment-rates/)
- [Set up automated sales tax](https://quickbooks.intuit.com/learn-support/en-us/help-article/sales-taxes/set-use-automated-sales-tax-quickbooks-online/L4Lx8eL7V_US_en_US)
- [Progress invoicing in QBO](https://gentlefrog.com/progress-invoicing-in-quickbooks-online/)
- [Add a deposit to an invoice](https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/deposit-invoice-showing-deposit-detail-report/L3kegGbO3_US_en_US)
- [QBO slow loading complaint thread](https://quickbooks.intuit.com/learn-support/en-us/banking/why-is-the-new-quickbooks-online-so-excruciatingly-slow-sept/00/1483787)
- [New Dashboard — Everyone hates it (Dec 2025)](https://quickbooks.intuit.com/learn-support/en-us/do-more-with-quickbooks/new-dashboard-everyone-hates-it-right-december-2025/00/1590198)
- [QBO ACH Convenience Fee thread](https://peakadvisers.com/blog/quickbooks-new-25-ach-convenience-fee-explained/)
- [NerdWallet QBO Review 2025](https://www.nerdwallet.com/reviews/small-business/quickbooks-online)
