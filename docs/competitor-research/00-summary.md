# Competitor Research — Synthesis

_Compiled 2026-04-25. Source files: `01-salesforce.md` through `21-voiceflow-vapi.md`._

This document is the strategic readout from a 21-platform research pass across CRM, restaurant/catering ops, financials, AI sales, marketing automation, and voice AI. It exists so we don't reinvent any wheel that someone else has already polished — and so we don't copy any wheel that someone else has already wrecked.

The ordering below maps to the original brief: **H** (prioritized backlog), **I** (flows to copy), **J** (anti-features to avoid), **K** (strategic moves).

The backlog in section H is the headline output. A roadmap-paste-ready expansion of section H lives in `99-features-to-steal-backlog.md`.

---

## H. Features to steal — prioritized backlog (top 40)

Ranked by a combined score across:
- **Impact** — does it solve a real Blu's BBQ pain today?
- **Effort** — small (1-2 days), medium (3-7 days), large (>1 week)
- **SaaS-relevance** — does it help the multi-tenant pivot, or only Blu's?
- **Differentiation** — does it help us stand out, or is it commodity table-stakes?

The full ranked list with rationale and source attributions is in `99-features-to-steal-backlog.md`. This section is the executive view — top 40 only, grouped by theme, with one-line rationales.

### Tier 1 — Quick wins (≤2 days each, high-impact, low-risk)

1. **Kanban column $-totals + count** _(Salesforce/Pipedrive)_ — sum of pipeline value per column, rendered in the column header. ~30 LOC.
2. **`viewed_at` / `opened_at` timestamps on quote PDFs** _(Pipedrive Smart Docs)_ — track when the customer opens the quote; surface in pipeline alerts. Closes biggest follow-up signal gap.
3. **Required fields at stage transition** _(HubSpot Stage Validation)_ — block kanban drag if required fields missing. Cleanest data-quality lever.
4. **AI-output visual differentiator** _(industry-wide pattern)_ — sparkle icon + faint gradient bg on every Claude-generated field, score, or draft. Critical trust signal.
5. **Per-line `tax_rate` + `tax_code`** _(Stripe/Square invoicing)_ — replace single `taxExempt` boolean. TX taxes alcohol/food/service differently.
6. **`hooks[]` array on inquiry record** _(Lavender Personalization Assistant)_ — Claude-extracted facts ("kosher requirement noted", "ordered 80 briskets in 2025") surfaced on the detail panel.
7. **Daily 7am "what the AI did" digest** _(AISDR/Regie habit)_ — push notification + email summary; one-tap kill-switch on dashboard. Trust accelerant.
8. **Buffer/Hootsuite-style queue grid** for Notification Center — visual slots, drag-rearrange, pre-built post-event email templates.
9. **`metadata: {}` JSON kv on every monetary record** _(Stripe convention)_ — universal tagging primitive; cheap to add, painful to retrofit.
10. **`fee_amount` separately stored on every payment record** _(Stripe data model)_ — gross + processor fee split; net cash queryable from day one.

### Tier 2 — Medium builds (3-7 days each, structural value)

11. **Three-column inquiry detail view** _(Salesforce/HubSpot/Pipedrive universal)_ — left = associations, middle = activity timeline + tabs, right = key properties. Replace current single-column detail pane.
12. **Unified activity timeline** _(Einstein Activity Capture / HubSpot)_ — chronological feed merging emails + calendar events + deposits + SMS + AI actions per customer. Highest-leverage UX move.
13. **First-class `Event` entity** _(CaterTrax/TPP)_ — multi-date, separate setup/service/breakdown timestamps, venue address ≠ caterer address, captain/sales-rep/kitchen-lead assignments. Promote events out of `inquiries:{threadId}` blob.
14. **`payment_requests[]` on invoices** _(Square Invoices data model)_ — replaces flat `deposits[]`; each request has `due_date`, `request_type` (DEPOSIT/MILESTONE/BALANCE), reminders, status.
15. **Hosted invoice URL + saved-card autocharge for balance** _(Stripe Invoicing pattern)_ — kill PDF-only path; offer "save card → auto-charge balance on event-day-minus-3."
16. **Reply-likelihood scorer in email composer** _(Lavender)_ — debounced Claude call; 0-100 score in right rail with traffic-light rings on Personalization / Tone / Reading Level / Subject.
17. **Inline coaching with `{span, suggestion, reason}` arrays** _(Lavender's spans pattern)_ — line-level squiggles + per-paragraph "Rewrite for me," never global rewrite.
18. **At-risk inquiry monitor + ranked alerts** _(Gong AI Deal Monitor)_ — Claude cron classifies each inquiry: silence / champion-loss / no-deposit / event-imminent. Ranked feed in `api/pipeline/alerts.js`.
19. **Hybrid deal-likelihood score with "why this score?"** _(Einstein + Gong)_ — 50% conversation signals, 50% activity signals; explainable expansion ("+12 industry match, −8 no engagement").
20. **Signal → Action router** _(Salesloft Rhythm + Regie auto-pilot)_ — every event becomes a Signal; small router maps signals to suggested actions, surfaced as a "Today's 5 actions" queue. Replaces hard-coded cadences.
21. **Embeddable "Get a Quote" widget** _(HubSpot live chat / Pipedrive LeadBooster)_ — drop-in JS that creates inquiries directly in our KV. Right architecture for SaaS multi-tenant lead capture.
22. **Multi-view on calendar/inquiries** _(ClickUp pattern)_ — Calendar / Board / List / Gantt over the same `events` array; `static/js/calendar.js` already returns the data, just needs a renderer per view.
23. **BEO (Banquet Event Order) template system** _(Toast EventView + TPP)_ — custom fields per event-type (corporate ≠ wedding); `internal=true` flag so kitchen-only fields don't leak to customer. PDF generator already exists; needs template variants.
24. **Branded customer portal per event** _(Toast EventView, TPP client portal)_ — single share-URL where customer sees current proposal, signs, pays deposits, chats. Same chrome as operator BEO view for visual continuity.
25. **Pre-built catering automation flow templates** _(Klaviyo flow library + ClickUp templates)_ — bake in: inquiry → quote → deposit reminder → 1-week confirm → event-day brief → post-event review. Ship as defaults; user opts in/out per inquiry.

### Tier 3 — Larger builds (>1 week, defining differentiators)

26. **Auto-generated kitchen prep sheet aggregating multi-events same day** _(Total Party Planner's killer feature)_ — group recipes by station (smoker / cold prep / sauce), subtract on-hand inventory, add buffer percentage, print station-by-station.
27. **Pack list auto-generated from menu items** _(TPP)_ — item → packing-requirement mapping (X half-pans, Y serving utensils, Z chafing setups). Massive operator time-saver; structural differentiator vs generalist tools.
28. **Voice-AI inbound phone answer** _(Vapi + Twilio + Claude Haiku + Deepgram + ElevenLabs)_ — ~$0.13–0.30/min all-in, ~700-900ms latency. Tools: `check_calendar`, `save_inquiry`, `transfer_to_zach`. Off-hours killer feature.
29. **Voice-cloned email drafts grounded in Zach's Sent folder** _(extension of Lavender pattern)_ — train style prior on real sent mail; every claim must cite a source span. Solves AI SDR's "hallucinated congratulations" problem at the root.
30. **Live food-cost / margin display while quoting** _(catering-specific R365/PeachWorks)_ — operator sees "you're at 38% food cost" inline. Not just post-event reporting.
31. **Multi-deposit schedule per event with ACH at ≤1%** _(catering best practice)_ — 25% / 50% / 25%, with a deliberate cost wedge on $5k+ deposits.
32. **Predictive next-event date for repeat customers** _(Klaviyo's predictive lifetime model)_ — start with median-interval-since-last heuristic; pre-warm an inquiry 30 days before predicted date. ML upgrade path later.
33. **Customer-initiated change-request flow** _(CaterTrax)_ — customer submits change via portal; operator reviews-and-approves; quote regenerates. Reduces the "10-email back-and-forth" pattern.
34. **A/B variants per follow-up step with auto-winner promotion** _(Outreach + Klaviyo)_ — KV counters + nightly p-value cron; operator-visible significance gating.
35. **Adaptive cadence (compress on engagement, pause+retone on silence)** _(Regie)_ — replaces our fixed-schedule QStash sends.
36. **Two-channel coordination (email + SMS)** _(SEP industry standard)_ — SMS only fires when email opened-but-not-replied for 36h. Already have `api/sms/` scaffold.
37. **Per-tenant guardrails for SaaS pivot** — daily send caps, per-domain throttles, bounce-rate alerts, spam-complaint kill switch. Required day-1 if we open multi-tenant outbound.
38. **Recipe → station mapping** _(catering-specific data model)_ — each prep recipe knows its station; prints as separate kitchen sheets.
39. **Visual flow builder over QStash scheduler** _(Klaviyo flows / ClickUp automations)_ — flow-graph UI ("trigger → wait 1 day → send → branch on reply") on top of our existing scheduler primitive.
40. **Stripe Connect for tenant payouts in SaaS pivot** _(Stripe Connect + multi-tenant pattern)_ — each tenant's deposits land in their own connected account; we take platform fee. Required for the SaaS pivot's payment story.

---

## I. Flows to copy — UX flows worth adapting

### Flow 1 — Quote → Invoice → Payment (Stripe + Square hybrid)
**Source:** Stripe Billing/Invoicing data model + Square Invoices' `payment_requests[]` shape + QuickBooks' template polish.

**Steps to adopt:**
1. Quote accepted → create Stripe **Customer** + **Invoice** with two `payment_requests`: 50% deposit (due immediately) + balance (due on event-day).
2. Send hosted invoice URL (kill PDF-only path; keep PDF as downloadable attachment).
3. Customer pays deposit; opt into "save card on file" via `setup_future_usage: 'off_session'`.
4. On event-day-minus-3, QStash creates a *second* PaymentIntent against the saved payment method; auto-charges balance.
5. Webhooks (`payment_intent.succeeded`, `invoice.paid`) update KV; UI reflects in real time.

**Why this shape:** card-network rules limit multicapture/auth-windows for catering's 30-60 day quote-to-event runway. Two PaymentIntents + saved card is the only safe pattern. Square's `payment_requests[]` array is the cleanest internal data model — translate to whichever provider the abstraction selects.

### Flow 2 — Lead capture → qualification → opportunity (Salesforce pattern, simplified)
**Source:** Salesforce Leads/Opportunities split; HubSpot's required-properties-at-stage; Einstein lead scoring.

**Steps to adopt:**
1. Embeddable widget on blusbarbeque.com → POST to `/api/inquiries/save` (already exists).
2. Auto-create inquiry in `inquiries:index` → status `new`.
3. Claude extraction fills basic fields; Einstein-style hybrid score lands on the card with explainable top-3 reasons.
4. Operator drag-to-stage → required-fields gate fires if the next stage's mandatory fields are blank.
5. At "quote sent" stage, automatic timer + signal-router watches for `viewed`, `replied`, `silent_72h` events.

**Why this shape:** prevents pipeline rot (data-quality gate at stage transitions), surfaces hot inquiries first (score), and replaces "drag for fun" theatre with consequential transitions.

### Flow 3 — Multi-channel inbox (Toast / Front pattern, scaled-down)
**Source:** Toast's "operations command center"; Front's unified inbox metaphor.

**Steps to adopt:**
1. One inbox view merges: Gmail threads, SMS conversations, voicemail transcripts (when voice-AI lands), and chat-approval queue items.
2. Each thread shares the same activity timeline shape across channels.
3. AI assistants (drafts, summaries) live as inline cards in the thread, not a sidebar.
4. Status auto-derived from message events (replied, silent for N days, etc.) — operator never manually marks "responded."

### Flow 4 — AI-assisted email composition (Lavender pattern)
**Source:** Lavender's right-side scoring sidebar + line-level squiggles.

**Steps to adopt:**
1. While composing in `static/js/quote-revise.js` or any draft surface, debounced Claude call returns `{score, sections: {personalization, tone, readability, subject}, spans: [{start, end, suggestion, reason}]}`.
2. Right rail renders score (0-100) with traffic-light rings per section.
3. Inline squiggles on flagged spans; click to accept/dismiss suggestion.
4. Per-paragraph "Rewrite this paragraph" button. **Never** a global "Rewrite the whole email" button — that's the path to slop.

### Flow 5 — Customer health scoring (Einstein + Gong pattern)
**Source:** Einstein opportunity scoring + Gong's deal-risk strip.

**Steps to adopt:**
1. Nightly cron computes per-inquiry score: combine deposit-paid, last-contact-recency, sentiment of last reply, calendar-distance.
2. Surface as colored left-edge strip on kanban cards (red/yellow/green) with hover-reason.
3. Detail panel exposes "+12 deposit paid, −8 silent for 5 days, −15 event in 7 days no balance" breakdown.
4. Cron also writes alerts into `api/pipeline/alerts.js` for the top-N risk items.

### Flow 6 — BEO + customer portal share-link (Toast EventView)
**Source:** Toast EventView; Total Party Planner client portal.

**Steps to adopt:**
1. After quote approval, generate a tenant-scoped share URL.
2. Customer page: current proposal, e-sign, deposit/balance status, change-request form, in-thread chat.
3. Operator's BEO view shares the same chrome — visual continuity signals quality.
4. Internal-only fields tagged `internal=true` never render on the customer page.

### Flow 7 — Voice-AI inbound (Vapi pattern)
**Source:** Vapi + Twilio + Claude Haiku + Deepgram + ElevenLabs.

**Steps to adopt:**
1. Twilio inbound number routes to Vapi orchestration endpoint.
2. STT (Deepgram, streaming) → Claude Haiku (with tool calls: `check_calendar`, `save_inquiry`, `transfer_to_zach`) → ElevenLabs TTS (streaming back).
3. Caller says "human" → immediate transfer (escape hatch is mandatory).
4. AI must tool-call to assert availability — never assert business state from training data.
5. ~$0.13–0.30/min all-in; ~700-900ms turn latency.

---

## J. Anti-features to avoid

These are confirmed failure modes from G2, Capterra, Reddit, and BBB complaints across the 21 sources. We pay nothing for these lessons by reading; we pay heavily by replicating them.

### Pricing / packaging anti-patterns
1. **Long-term contracts with auto-renewal and ETFs** _(Toast 2-3yr, Outreach annual)_ — single biggest operator complaint across sources. Our SaaS must be **month-to-month**.
2. **AI consumption-pricing without a live meter or cap** _(Salesforce $2/conversation, Flex Credits)_ — surprise bills churn customers. Show meter in real time; enforce caps.
3. **Auto-upgrade pricing tiers without explicit consent** _(HubSpot marketing-contact trap → BBB complaints)_ — always notify and require opt-in.
4. **API gated behind Enterprise tier** _(Salesforce)_ — hostile to small tenants. **Ship API at every paid tier** (Pipedrive does this right).
5. **Hardware lock-in via proprietary devices** _(Toast)_ — $5k+ bricks on cancellation. Stay BYO-hardware.
6. **Module sprawl à la carte** _(Toast, CaterTrax)_ — Catering Pro, KDS, Loyalty, Marketing, Payroll all separate add-ons. Real-world all-in $1,000-2,200/mo. **Bundle aggressively.**
7. **High setup fees** _(TPP $600-1k, ChowNow $119-499, HubSpot $1.5-3.5k)_ — friction at the moment of highest doubt. **No setup fee, ever.**
8. **Hidden fees on customer transactions** _(Toast $0.99 guest fee, Square's account holds, opaque processing markups)_ — publish all rates; never charge the operator's customer a markup we keep.
9. **Card-updater services to bill canceled cards** _(HubSpot BBB complaints)_ — catastrophic trust loss. Always honor cancellation.
10. **Hard caps on the tier's headline feature** _(Pipedrive automation count, HubSpot sequence quota on Starter)_ — don't ship a tier whose own selling point is unusable.
11. **Per-feature SKU pricing** _(CaterTrax $150/feature)_ — Toast-style sprawl by another name.
12. **Per-location pricing for SMB** — most caterers run one kitchen; per-location alienates the actual market.
13. **Commission-on-customer-payment** — operators hate it; ChowNow's commission-free wedge proves it; do not introduce it.

### UX / product anti-patterns
14. **Auto-upgrade tiers via "marketing contact" semantic redefinitions** _(HubSpot)_ — silent re-categorization changes billable count.
15. **Five overlapping automation tools** _(Salesforce: Workflow Rules + Process Builder + Flow + Apex Triggers + Approval Processes)_ — pick **one** automation primitive, make it great.
16. **Mandatory data-platform prerequisite for AI** _(Salesforce Data Cloud at $50-150/seat)_ — ground AI in the primary store from day one.
17. **Forced redesign with no rollback** _(QuickBooks 2024-2025 invoice and dashboard redesigns)_ — silently removed fields (Accepted Date, Internal Note, Order Number). **Ship redesigns additively, gate behind a flag, ~6mo opt-in.**
18. **Page-load latency in financial UIs** _(QuickBooks 10-20s page loads)_ — keep our SPA architecture; never go multi-page.
19. **Tag-spaghetti** _(Mailchimp)_ — multiple grouping primitives (Tags + Groups + Segments + Audiences). **Pick one.**
20. **Feature sprawl at scale** _(ClickUp 40-widget dashboards)_ — opinionated defaults always; resist the "everything is configurable" temptation.
21. **Naming chaos** _(Salesforce: Einstein → Copilot → Agentforce → Agentforce 1 in 24 months)_ — pick a name and commit.
22. **Spreadsheet UI for non-financial users** _(PeachWorks)_ — drives away kitchen staff; wizard-style flows for kitchen tasks.
23. **No native catering data model in generalist tools** _(Square treats catering as "future-dated order")_ — first-class Event entity day one.
24. **Mobile under-investment** _(Toast/CaterTrax/TPP/PeachWorks)_ — catering is field work; mobile-first is an open lane.
25. **No human escape hatch in voice AI** — caller says "human" must transfer immediately, no exception.
26. **Per-turn tool calls** _(Vapi misuse)_ — cache in session vars; ballooning latency otherwise.
27. **Long robotic AI disclaimers at call open** — kills trust before turn 1 ("This call may be recorded… I am an AI… how may I help…"). Disclaimer briefly, then immediately functional.
28. **Hallucinated availability assertions** — voice agent must tool-call to check; never assert business state without a round-trip.
29. **Pricing cliffs at per-contact tier boundaries** _(Mailchimp)_ — bill-shock; smooth metering wins.
30. **Forever-flows with no exit predicate** _(many automation tools)_ — always add "stop on goal" condition.

### AI / sales anti-patterns
31. **"Surveillance theater"** _(Gong's reputation problem)_ — AI scoring used as PIP material destroys rep trust. Frame AI scoring as personal coaching; default dashboards to "personal mode" if multi-user lands.
32. **Hallucinated outbound auto-send** _(AI SDR category curse)_ — fabricated "congrats on your Series C," cookie-cutter personalization tank reply rates and damage domain. **Always draft-and-approve; ground every claim with citations.**
33. **Email deliverability damage at scale** _(Outreach/Salesloft chronic issue)_ — Google's 0.3% spam-complaint threshold is unforgiving. Ship per-tenant daily caps + per-domain throttles + bounce-rate alerts day 1.
34. **Score gaming / fixation** _(Lavender 0-100 score)_ — cosmetic optimization beats real reply rate. Show score *and* the historical reply-rate of similar drafts.
35. **Public-post personality scoring (OCEAN/DISC)** _(Lavender Personalization Assistant edge cases)_ — creepy energy; avoid.
36. **No kill switch on autonomous mode** _(AI SDR vendors)_ — must be one tap from operator to halt all auto-actions.
37. **Notification spam by default** _(all SEPs)_ — ship digest mode by default; opt-in to real-time.
38. **Quietly degrading free tiers** _(Mailchimp 2025, Wave 2025 bank-feeds paywall)_ — trust-burning. **Grandfather existing users into legacy pricing forever.**

---

## K. Strategic recommendations — 10 high-level moves

### 1. Position the SaaS pivot as "the catering AI back-office that doesn't lock you in."
Toast/CaterTrax/TPP all ship contracts, hardware lock-in, processor lock-in, and module sprawl. Our entire wedge is the inverse: month-to-month, BYO hardware, BYO payment processor (the abstraction is already built), no setup fee, and AI baked in at every tier — not as a $50/seat upsell. Lavender's $29-69/mo grid is the closest comp; aim there.

### 2. Build a free tier that demos the AI flywheel.
Catering operators won't trust AI extraction/drafting until they've seen it work on their own emails. Free tier shape: 1 shop / 1 user / 25 inquiries-per-month / "Powered by Blu" footer / unlimited AI extraction on those 25 inquiries. Convert at "I'm hiring help" or "I want to remove the badge."

### 3. Ship a unified Activity Timeline before adding any new feature.
Almost every research thread (Salesforce, HubSpot, Gong, Lavender, Klaviyo, Toast) converges on the same UI primitive: a per-customer chronological feed merging emails, calls, payments, calendar events, and AI actions. We have the data; we don't have the surface. This is the highest-leverage single move available.

### 4. Promote `Event` to a first-class entity.
Today: `inquiries:{threadId}` is a blob. Catering-specific tools (CaterTrax, TPP) all model events explicitly with multi-date, separate setup/service/breakdown timestamps, venue ≠ caterer address, and crew assignments. Migration is a week of work but unlocks the BEO templates, kitchen prep sheets, pack lists, and customer portal. This is the data-model move that converts our hobby project into a category-leader-shaped tool.

### 5. Standardize on Stripe Invoicing's `payment_requests[]` shape internally.
Even if we stay payment-provider-agnostic on the outside (the abstraction is the right call), the internal data model should mirror Stripe's. It cleanly handles deposit/milestone/balance, refunds, disputes, partial payments, and saved-card autocharge. Square's similar `payment_requests[]` confirms this is the industry-converged shape.

### 6. Bake catering-specific automations as defaults, not blank canvases.
Klaviyo and ClickUp both win because they ship templates. Our differentiator is AI extraction, not visual flow editors. Pre-build: inquiry → quote → 48h follow-up → deposit reminder → 1-week confirm → event-day brief → post-event review. Operator one-click enables; AI fills variables; never ask them to assemble a flow from primitives.

### 7. Voice AI is the SaaS hook — ship it for Blu's first.
Vapi + Twilio + Claude Haiku + Deepgram + ElevenLabs at $0.13-0.30/min is dramatically cheaper than every restaurant voice-AI vendor ($450-600/mo flat). Catering inquiries are an easier voice problem than QSR. Ship for Blu's; reuse the architecture verbatim per-tenant in the SaaS. This is the headline pitch the SaaS needs.

### 8. Make AI explainable everywhere, scored visually, and always interruptible.
Three patterns repeat across Einstein, Gong, Lavender, Regie:
- **Explainable** ("+12 industry match, −8 silent for 5 days") — never opaque scores.
- **Visually distinguished** (sparkle icon, faint gradient bg) on every AI artifact.
- **Always interruptible** (kill switch on dashboard, never auto-send, draft-and-approve).
Treat these as design system primitives, not per-feature decisions.

### 9. Ship deliverability + sending guardrails before opening multi-tenant outbound.
Every SEP (Outreach, Salesloft) has a deliverability scandal in their history. The instant we let other operators send through our infrastructure, we inherit that risk. Required day 1: per-tenant daily caps, per-domain throttles, bounce-rate alerts, spam-complaint kill switch, opt-out enforcement. Build the meter before you build the firehose.

### 10. Treat the existing stack as a moat, not technical debt.
Single-page `index.html` + serverless API + Upstash KV is dramatically cheaper to operate per-tenant than every competitor's stack. QuickBooks is paying for the page-load latency. Salesforce is paying for the multi-cloud sprawl. We get to be fast and cheap because we made small choices. Resist the urge to "professionalize" into a microservices architecture as the SaaS scales — the simplicity *is* the differentiator. Multi-tenant via tenant-scoped KV keys; horizontal scaling via Vercel; that's the entire story.

---

## Appendix — Source attribution map

| Theme | Strongest sources |
|-------|-------------------|
| Pipeline UI (kanban, $-totals, stage gates) | 01-salesforce, 03-hubspot, 04-pipedrive |
| AI explainability + scoring | 02-salesforce-einstein, 13-gong, 15-lavender |
| Quote-to-payment data model | 09-quickbooks, 12-stripe-square-payments |
| Catering-specific entities (Event, BEO, prep, pack list) | 05-toast, 08-catering-specific-tools |
| AI sales-cadence patterns | 13-gong, 14-aisdr-regie, 16-outreach-salesloft |
| Email composition assistance | 15-lavender |
| Marketing automation flow shapes | 17-clickup, 19-mailchimp-klaviyo |
| Voice-AI architecture | 20-voice-ai-restaurants, 21-voiceflow-vapi |
| Anti-patterns (contracts, lock-in, sprawl) | 05-toast, 09-quickbooks, 16-outreach-salesloft |

The roadmap-paste-ready expansion of section H is in `99-features-to-steal-backlog.md`.
