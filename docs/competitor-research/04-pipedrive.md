# Pipedrive

The pipeline-first CRM. Built around one screen — the kanban deal board — and ruthlessly optimized for "salesperson actually inputs the data because the UX is fast." Beloved on Reddit by ops-light teams; hated by analysts who need deep reports.

## A. Core value prop

Pipedrive is a sales CRM organized entirely around a visual kanban pipeline; minimal cognitive load means salespeople actually use it, which means the data is actually current. The pitch is "you'll be set up in under 30 minutes and your reps won't quit."

## B. Top 5 features worth copying

The headline feature is the **kanban pipeline as the home screen** — when you log in, you land on a drag-and-drop board, not a dashboard. Every deal is a card, every stage is a column, every column shows count + total value. This obsession with one canonical view is the entire value prop and is directly copy-able to Blu's pipeline page (which already gestures at this). Second is the **"focus on next activity" model**: every deal *must* have a next-step activity, and deals without one get flagged red. This single UX rule fixes the universal CRM problem of "deals rot in pipeline because nobody scheduled the next call." Third is **Smart Docs / quote-and-proposal generation built into the deal record** — generate a PDF quote inline, send via tracked link, get notified when viewed; this maps perfectly to Blu's quote PDF flow but adds the open/view tracking that today is missing. Fourth is the **LeadBooster suite** (chatbot + web forms + live chat + scheduler) — pre-qualify inbound leads before they hit a human, with the chatbot creating Pipedrive deals automatically; the catering equivalent is "Get a Quote" widget that asks 5 qualifying questions (date, headcount, location, menu interest, budget) before creating an inquiry. Fifth is **Workflow Automation with branching** — visual rule builder ("when deal moves to X, send email Y, wait Z days, if no reply, create activity"); cleaner than HubSpot's split between Sequences and Workflows because there's only one tool, but with goal-tracking and conditional branches.

## C. Notable UI patterns

The kanban-first home screen is the load-bearing UI choice and everything else flows from it: cards are dense (name, amount, days-in-stage, next activity, owner avatar), drag-to-move-stage is one motion, count + total live in the column header, and clicking a card slides a side-panel record open without leaving the board. Mobile is the same kanban with horizontal swipe between stages. The deal-detail side-panel uses a **left-rail with stage stepper, middle-column with activity timeline, right-rail with deal details + people + products** — a tighter version of the Salesforce/HubSpot three-column. Custom fields are added inline on the record (no schema-builder tool to navigate to), which makes one-off "I want to track X for this customer" trivial. The whole product is designed for **<30-minute setup**: the empty-state has a 4-step wizard, and the default pipeline ships with sensible stage names that 80% of users keep. Color coding on cards (red = rotting, gray = won/lost, neutral = active) is consistent across every view. Notably, Pipedrive does *not* show power users a wall of dashboards on login — the bet is that pipeline view = your dashboard.

## D. Data model insights

Pipedrive's data model is the simplest of the four CRMs reviewed and arguably the right starting point for a catering SaaS. Five core entities: **Deal** (the opportunity, lives in a pipeline with a stage), **Person** (an individual contact), **Organization** (a company; many-to-one from Person), **Activity** (a task/meeting/call with a due date, optionally linked to a deal/person/org), and **Product** (a SKU with price, optionally added to deals as line items). All five share the same field model: default fields + system fields + custom fields, with 16 custom field types (text, numeric, date, single-select, multi-select, etc.). Deals can link to one Person, one Organization, multiple Products, and multiple Activities. There is no separate "Lead" object on lower tiers — leads are just deals in an early stage (this is contentious; many users wish for a real Lead object, which Pipedrive added in higher tiers as the "Leads Inbox" feature). For Blu's BBQ, the Deal+Person+Organization+Activity+Product model maps directly: Deal = inquiry, Person = primary contact at the catering customer, Organization = the company (for corporate caterings), Activity = follow-up tasks, Product = menu items as line items on the quote. The clean unified-Activity model (one table for all task types) is what Blu's currently lacks — emails, deposits, calendar events, SMS each live in their own KV namespace today; consolidating to one `activities` table keyed by deal would be the single highest-leverage data-model refactor.

## E. Integration ecosystem

Pipedrive's marketplace lists 350+ native integrations across Communication (Twilio, Slack, Zoom, Microsoft Teams, Gmail), Payments (Stripe — sync customers, invoices, payments to deals), Productivity (Google Workspace, Microsoft 365, Trello, Asana), Marketing (Mailchimp, ActiveCampaign), and Telecom (NUACOM, JustCall, Aircall for click-to-call from a deal record). Stripe integration creates Stripe customers from Pipedrive Persons and syncs invoices back as deal-related records — very close to the integration shape Blu's payment abstraction layer aims at. Twilio is native (not Zapier-mediated as in HubSpot) — significant given Blu's already has SMS scaffolding. Zapier covers the long tail (8,000+ apps). Pipedrive also publishes a documented REST API and webhooks on every entity, available at every paid tier (unlike Salesforce, which gates API behind Enterprise) — the right posture for a small SaaS to copy.

## F. Pricing model

Per-seat, monthly, no free tier (a notable gap):

| Tier (current naming) | Price/seat/mo (annual) | Notes |
|------|--------|-------|
| Lite (was Essential) | $14 | Basic pipeline + activities |
| Growth (was Advanced) | $39 | Email + automation |
| Premium (was Professional/Power) | $49 | Reporting + forecasting |
| Ultimate (was Enterprise) | $79 | SSO, audit, custom permissions |

Add-ons stack on top: LeadBooster $32.50/mo, Web Visitors $41/mo, Campaigns $13.30/mo, Smart Docs $32.50/mo. A 5-person team on Professional with two add-ons easily hits $300–$350/month. Monthly billing (vs annual) costs ~35% more. The pricing is the most predictable of the four CRMs reviewed (no contact-tier surprises like HubSpot, no AI consumption surprises like Salesforce), but the lack of a free tier limits PLG. For a catering SaaS pivot the lesson is: **per-seat is fine if the price is honest and the meter is visible**, but launching without a free tier (or at minimum a 14-day trial with no credit card) is the single biggest acquisition headwind.

## G. Anti-patterns — DO NOT COPY

The biggest one is **weak reporting on the cheap tiers** — analytics that B2B operators expect are gated to Premium+, with cohort analysis and territory reporting absent even at Ultimate. This generates the most consistent complaints across G2/Capterra/Reddit. Don't gate basic conversion-rate-by-stage and revenue-by-source reports behind upper tiers. Second, **automation has hard ceilings on workflow count and branching depth** — users hit the cap and bounce to nethunt or HubSpot. Don't make automation a tier-limited resource; make the cheapest tier's automation usable for the use cases the tier is sold for. Third, **no native marketing automation** (only an add-on or external integration) — for a sales CRM this is a strategic choice, but for a catering SaaS the line between "sales follow-up" and "marketing nurture" is fuzzy and forcing customers to adopt a separate tool fragments the experience. Fourth, **no free tier**, only a 14-day trial — limits PLG growth, exactly the surface where Salesforce and HubSpot are eating share. Fifth, **add-on pricing creates surprise totals**: LeadBooster + Smart Docs + Campaigns can double the base seat price without warning. Don't sell "$14/seat" if the actual common config is $60/seat. Sixth, **support is consistently called out as weak** on Reddit and review sites, especially compared to HubSpot — for a small SaaS, support quality is a moat, not a cost center. Seventh, **the Lead/Deal duality** (Leads in a separate inbox in higher tiers, but lower tiers shoehorn unqualified leads into the Deal pipeline) creates two competing mental models — pick one and ship it everywhere from day one.

Sources:
- [Pipedrive Pricing 2026](https://saascrmreview.com/pipedrive-pricing/)
- [Pipedrive Data Organization (KB)](https://support.pipedrive.com/en/article/how-is-pipedrive-data-organized)
- [Pipedrive Custom Fields (KB)](https://support.pipedrive.com/en/article/custom-fields)
- [Pipedrive Marketplace](https://www.pipedrive.com/en/marketplace)
- [Pipedrive Pipeline Management](https://www.pipedrive.com/en/features/pipeline-management)
- [Pipedrive Automation Limitations (NetHunt)](https://nethunt.com/blog/pipedrive-automation-limitations-what-you-cant-automate-based-on-real-user-feedback/)
- [Pipedrive Review 2026 (Lindy)](https://www.lindy.ai/blog/pipedrive-review)
- [Pipedrive Review 2026 (OnePageCRM)](https://www.onepagecrm.com/crm-reviews/pipedrive/)
