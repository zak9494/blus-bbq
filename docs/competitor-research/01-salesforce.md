# Salesforce (Sales Cloud)

The 800-lb gorilla of CRM. Heavyweight, deeply customizable, expensive. Worth studying because every CRM either copies them or defines itself in opposition.

## A. Core value prop

Salesforce Sales Cloud is the system-of-record for B2B sales: every customer, every deal, every touchpoint, with a near-infinitely customizable data model and automation engine. The pitch isn't "easy" — it's "this can model literally any sales process your business will ever have."

## B. Top 5 features worth copying

1. **Path component (stage walker on the record).** A horizontal stepper pinned at the top of every Opportunity / Lead record showing the current stage, with up to 5 "key fields" exposed per stage and freeform "Guidance for Success" copy admins can write per stage. Confetti fires on closed-won. Directly portable to Blu's pipeline cards: surface the 3-5 fields that actually matter at each stage (e.g., headcount + date locked at "Quote Sent", deposit amount at "Deposit Pending"), instead of the same generic card everywhere. The "guidance" hook is the killer feature — owner-written tips per stage = institutional knowledge encoded in the UI.
2. **Kanban with sum/count per column.** Drag-and-drop pipeline where each column header shows the count of deals AND the dollar sum, with click-through inline editing for key fields without leaving the board. Today Blu's pipeline shows tile counts; adding the dollar-sum total per column is a one-line change with massive perceived value for a sales operator.
3. **Activity timeline auto-merging email + meetings + calls.** Einstein Activity Capture (see Einstein doc) auto-logs Gmail/Outlook threads onto records, but the *display* pattern — a single chronological feed mixing emails, calls, calendar events, and notes on the right rail of a record — is the canonical CRM UX. Worth copying for the SaaS pivot: catering inquiries already have email threads, calendar events, and deposit moves; merging them into one timeline view per inquiry would 10x the "I can see what happened" feeling.
4. **Validation rules as first-class platform feature.** Admins write declarative rules ("Stage cannot move to Closed Won if Amount is empty"), enforced at save time, with custom error messages. For a SaaS pivot this is huge: catering ops have data-quality footguns (no event date, no headcount, etc.), and a config-driven validation layer beats hard-coded checks scattered through handlers.
5. **Reports + Dashboards with drag-build report builder.** Non-engineer users compose reports by picking an object, dragging fields, applying filters and groupings, then pinning charts to a dashboard. This is the lever that lets ops people self-serve without filing tickets — and is exactly what Blu's "self-modify" feature gestures at, but for analytics. Worth a lite version even if just for top-level metrics (deals/month by source, win rate by quote-tier).

## C. Notable UI patterns

The Lightning Experience (current-gen UI) is built around a few load-bearing patterns:

- **Three-column record page.** Left rail = related lists (other records linked to this one), middle = activity timeline + tabs, right rail = key details panel. Most CRMs copy this exact layout.
- **Path stepper (described above).** Always horizontal, always at the top, click-to-update-stage with a "Mark Complete" button.
- **Lightning App Builder with component visibility rules.** Admins drag components onto a record page; each component can be visibility-gated by user profile or field value, so a single page template renders differently for SDRs vs. AEs vs. CSMs. The "one page, many faces" approach beats maintaining separate pages.
- **Global search that returns mixed-object results** (Accounts, Contacts, Opportunities, Leads, Cases all in one dropdown grouped by type). Blu's index.html has no global search yet — adding one that searches inquiries + customers + calendar events would be a high-leverage addition.
- **In-app guided setup ("Trailhead-in-app" wizards).** New tenants get walkthroughs on first login. For a SaaS pivot this is mandatory — catering owners are not technical.

The downside: there is *too much* on screen. Density is information-dense to the point of overwhelming. Blu's UI should borrow the structure but not the density.

## D. Data model insights

The standard object graph is:

- **Lead** — an unqualified contact; lives in a separate table from Contact/Account. On qualification, "Convert Lead" creates an Account + Contact + Opportunity in one action.
- **Account** — the company (or person, in B2C "Person Accounts" mode).
- **Contact** — a person at an Account (many-to-one to Account).
- **Opportunity** — a deal in flight, with Stage, Amount, Close Date, Probability. Many-to-one to Account, optional many-to-many to Contacts via OpportunityContactRole.
- **Activity** (Task / Event) — polymorphic; a Task can be related to a Lead, Contact, Account, or Opportunity via the `WhatId` / `WhoId` fields. This polymorphic activity model is the right abstraction.
- **Custom Objects** — admins can spin up arbitrary tables with custom fields and lookup relationships, no code required.

**What Blu's data model is missing today:**
- The **Lead → Account+Contact+Opportunity conversion** moment. Today an inquiry becomes an inquiry. There's no separation between "raw email" and "qualified lead with a real customer profile attached." For repeat-customer flows and the SaaS pivot, you want a Customer entity that survives across many inquiries (this is the Account/Contact split).
- **Polymorphic activity table.** Today emails live in inquiries, deposits live in deposits, calendar events live in calendar — there's no unified `activities` table you can query as "everything that happened to this customer." Worth adding a `customer_activities` KV namespace keyed by customer email, where each entry has a type (email_sent, deposit_paid, event_booked, sms_sent) and a target_id. Powers the timeline view in C above.
- **Stage history.** Salesforce auto-tracks every stage change on Opportunity (timestamp, who, from-stage, to-stage). Powers conversion-rate analytics. Today Blu's pipeline has phases but doesn't log transitions.

## E. Integration ecosystem

AppExchange is the moat. ~7,000 listed apps, with first-party connectors for:
- **Slack** (Salesforce owns Slack; deep two-way: post deal-won to channel, search records from Slack)
- **Stripe** (AppExchange listing; sync customers, invoices, subscriptions; embed billing UI inside SF records)
- **Twilio** (AppExchange listing; send/receive SMS from contact records, log to activity timeline)
- **Gmail / Outlook / Google Calendar** (Einstein Activity Capture — email and meeting auto-sync)
- **DocuSign, Zoom, LinkedIn Sales Navigator, QuickBooks, ServiceNow, SAP, MS Dynamics**

Plus a documented REST API on every object, SOAP API for legacy, Bulk API for big imports, Streaming API (CDC events) for real-time downstream sync, and Apex (server-side code) for arbitrary logic. The API-first posture is the foundation everything else is built on.

**Lesson for SaaS pivot:** even a tiny catering CRM should publish a stable REST API per object from day one and treat third-party integrations as a marketplace, not bespoke per-customer work. Webhook-out on every state change is table stakes.

## F. Pricing model

All per-user/month, billed annually:

| Tier | Price | Notes |
|------|-------|-------|
| Starter Suite | $25 | Limited; designed to onboard SMBs |
| Pro Suite | $100 | Squeezed in 2024 between Starter and Pro |
| Professional | $80 | (overlaps with Pro Suite confusingly) |
| Enterprise | $165 | First tier with full API access — the real "starting line" for serious customers |
| Unlimited | $330 | + 24/7 support, sandboxes |
| Einstein 1 / Agentforce 1 | $500–$650 | Adds AI; see Einstein doc |

No free tier. Implementation typically requires a partner ($10k–$100k+ for setup). Annual contracts are standard, multi-year discounts common.

**Key insight:** the *real* price is per-seat × seats × tier × add-ons × Data Cloud × Einstein × implementation. Customers routinely report 3-5x the sticker price. This is both the moat and the vulnerability — anyone undercutting them with predictable flat-rate pricing has a story to tell.

## G. Anti-patterns — DO NOT COPY

1. **API access gated behind Enterprise tier.** Locking integrations behind the $165/seat tier is hostile to small customers. Blu's SaaS should have API access at every tier (rate-limited if needed).
2. **"Spaghetti sharing model."** Salesforce's permission model (profiles + permission sets + roles + sharing rules + manual shares + territories) is so flexible it becomes unmaintainable. Pick a simpler model (RBAC with a small fixed set of roles) and resist scope creep.
3. **"Automation Bonanza."** Workflow Rules + Process Builder + Flow + Apex Triggers + Approval Processes — five overlapping ways to automate the same thing, with no clear guidance which to pick. Triggers fire each other. Debugging is nightmare. Pick *one* automation primitive and make it great.
4. **"Click-depth tax."** Common operations (e.g., "log a call on this contact") routinely take 4–6 clicks. The UI is dense AND deep. Optimize for: any common action ≤ 2 clicks from any context.
5. **Auto-upgrade pricing tiers / usage cliffs.** Salesforce loves consumption pricing on AI ($2/conversation, "Flex Credits", Data Cloud rows) without hard caps — surprise bills. SaaS pricing should be predictable; if usage-based, surface a real-time meter and a cap.
6. **"Big Ball of Mud" customizations.** Because everything is customizable, every long-lived org becomes an undocumented mess. Defaults matter. Ship strong opinionated defaults and resist letting customers customize core flows in v1.
7. **Mandatory Data Cloud for AI.** Charging $50–$150/seat extra for the data substrate AI requires is a footgun. Bake the data layer into the base price.

Sources:
- [Salesforce Sales Cloud Pricing 2026 (Method)](https://www.method.me/blog/how-much-does-salesforce-cost/)
- [Path & Kanban (Trailhead)](https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/visualize-success-with-path-and-kanban)
- [Salesforce Anti-Patterns (Salesforce Ben)](https://www.salesforceben.com/a-guide-to-6-salesforce-anti-patterns/)
- [Salesforce Data Model (Revenue Ops)](https://www.revenueopsllc.com/understanding-salesforce-objects-accounts-contacts-leads-and-opportunities/)
- [Salesforce + Stripe (AppExchange)](https://appexchange.salesforce.com/appxListingDetail?listingId=4dff0f8e-0b10-47c2-a3a3-f3905e7f7927)
- [Twilio for Salesforce (AppExchange)](https://appexchange.salesforce.com/appxListingDetail?listingId=a0N3A00000EtEuBUAV)
