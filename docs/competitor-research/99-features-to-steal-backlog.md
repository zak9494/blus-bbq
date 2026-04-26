# Features to Steal — Prioritized Backlog

_Generated 2026-04-25 from competitor research synthesis. Format mirrors `ROADMAP.md` so entries can be pasted into Wave sections directly._

Each entry has: priority tier, source, effort estimate, impact area (Blu's-only / SaaS-relevant / both), and a 1–3 sentence rationale.

**Effort sizing:**
- **S** — small, ≤2 days
- **M** — medium, 3–7 days
- **L** — large, >1 week

**Impact area:**
- 🍖 — Blu's BBQ today
- 🚀 — SaaS pivot
- 🍖🚀 — both

---

## Tier 1 — Quick wins (paste into the next Wave 3 / Wave 5 batch)

These are ≤2-day builds with high impact and low risk. Treat as the immediate "start tomorrow" list.

- [ ] **Kanban column $-totals + count** _(S, 🍖🚀)_ — Sum pipeline value per kanban column, render in column header next to count. Source: Salesforce / Pipedrive / HubSpot universal pattern. ~30 LOC in `static/js/` kanban renderer. Closes the "kanban looks busy but I can't see the dollar weight" gap.
- [ ] **`viewed_at` / `opened_at` timestamps on quote PDFs** _(S, 🍖🚀)_ — Track when the customer opens the quote PDF; surface the open as a pipeline alert. Source: Pipedrive Smart Docs. Pixel tracker on the PDF link or hosted-quote URL → `inquiries:{threadId}.activityLog`. Closes the single biggest follow-up signal gap we have today.
- [ ] **Required fields at stage transition** _(S, 🍖🚀)_ — Block kanban drag if required fields for the destination stage are blank; modal lists missing fields. Source: HubSpot Stage Validation. Cleanest data-quality lever in the research; prevents pipeline rot.
- [ ] **AI-output visual differentiator** _(S, 🍖🚀)_ — Sparkle icon + faint gradient background on every Claude-generated field, score, or draft. Source: Salesforce Einstein / Lavender / industry-wide. Critical trust signal; easy to add as a CSS class + JSX wrapper.
- [ ] **Per-line `tax_rate` + `tax_code`** _(S, 🍖🚀)_ — Replace the single `taxExempt` boolean on quote line items with per-line `tax_rate` + `tax_code`. Source: Stripe / Square invoice data model. Texas taxes alcohol, food, and certain service charges differently; today's schema can't represent the real world.
- [ ] **`hooks[]` array on inquiry record** _(S, 🍖🚀)_ — Claude-extracted facts ("kosher requirement noted", "ordered 80 briskets in 2025") stored on the inquiry, surfaced on the detail panel as "what we know about this customer." Source: Lavender Personalization Assistant. Cheap to wire up — extraction is already happening, just need to persist it.
- [ ] **Daily 7am "what the AI did" digest** _(S, 🍖)_ — Push notification + email summary of all AI actions in last 24h. One-tap kill-switch on the dashboard halts all auto-actions. Source: AISDR / Regie habit. Trust accelerant; makes future autonomous features palatable.
- [ ] **Buffer-style queue grid for Notification Center** _(S, 🍖🚀)_ — Visual slots, drag-rearrange, pre-built post-event email templates. Source: Buffer + Hootsuite scheduler grid + ClickUp marketing calendar. Also unlocks the "Post Catering Emails" subsection already in Wave 3.
- [ ] **`metadata: {}` JSON kv on every monetary record** _(S, 🚀)_ — Universal tagging primitive on quotes, deposits, refunds. Source: Stripe convention. Cheap to add now, painful to retrofit; required for SaaS multi-tenancy and arbitrary tags.
- [ ] **`fee_amount` separately stored on every payment record** _(S, 🚀)_ — Gross + processor fee split. Source: Stripe data model. Net cash queryable from day one; impossible to bolt on cleanly later.

## Tier 2 — Medium builds (paste into Wave 5 / Wave 6 planning)

These are 3–7 day builds delivering structural value. Sequence them so Activity Timeline lands first — it unlocks several others.

- [ ] **Three-column inquiry detail view** _(M, 🍖🚀)_ — Left rail = customer associations (past events, deposits, threads). Middle = activity timeline + tabs. Right rail = key properties + AI hooks. Source: Salesforce / HubSpot / Pipedrive universal. Replace current single-column detail pane.
- [ ] **Unified activity timeline** _(M, 🍖🚀)_ — Chronological feed merging emails + calendar events + deposits + SMS + AI actions per customer. Source: Einstein Activity Capture / HubSpot. Highest-leverage UX move available; data already exists, surface doesn't.
- [ ] **First-class `Event` entity** _(M, 🍖🚀)_ — Promote events out of `inquiries:{threadId}` blob. Multi-date support, separate setup/service/breakdown timestamps, venue address ≠ caterer address, captain/sales-rep/kitchen-lead assignments. Source: CaterTrax / Total Party Planner. Migration unlocks BEO templates, kitchen prep sheets, pack lists, customer portal.
- [ ] **`payment_requests[]` on invoices** _(M, 🍖🚀)_ — Replaces flat `deposits[]`. Each request has `due_date`, `request_type` (DEPOSIT/MILESTONE/BALANCE), `percentage` or `fixed_amount`, `reminders[]`, `status`. Source: Square Invoices internal model.
- [ ] **Hosted invoice URL + saved-card autocharge for balance** _(M, 🍖🚀)_ — Send hosted URL (kill PDF-only path; keep PDF as attachment). Customer pays deposit + opts into "save card → auto-charge balance on event-day-minus-3." Source: Stripe Invoicing pattern. Two PaymentIntents + saved card is the safe pattern given multicapture restrictions.
- [ ] **Reply-likelihood scorer in email composer** _(M, 🍖🚀)_ — Debounced Claude call on every draft; 0–100 score in right rail with traffic-light rings on Personalization / Tone / Reading Level / Subject. Source: Lavender. Highest-impact AI feature in the research stack for our drafting flow.
- [ ] **Inline coaching with `{span, suggestion, reason}` arrays** _(M, 🍖🚀)_ — Line-level squiggles on flagged spans + per-paragraph "Rewrite this paragraph" button. Source: Lavender. Never expose a global "Rewrite the whole email" — that's the path to AI slop.
- [ ] **At-risk inquiry monitor + ranked alerts** _(M, 🍖🚀)_ — Claude cron classifies each inquiry: silence / champion-loss / no-deposit / event-imminent. Ranked feed in `api/pipeline/alerts.js`. Source: Gong AI Deal Monitor. Builds on existing alerts infrastructure.
- [ ] **Hybrid deal-likelihood score with "why this score?"** _(M, 🍖🚀)_ — 50% conversation signals (sentiment, response speed, mention of competitors), 50% activity signals (deposit paid, calendar distance, last-contact recency). Expandable to "+12 industry match, −8 silent for 5 days." Source: Einstein + Gong. Heuristic v1, learned weights v2.
- [ ] **Signal → Action router** _(M, 🚀)_ — Every event becomes a Signal; small router maps signals to suggested actions, surfaced as a "Today's 5 actions" queue. Source: Salesloft Rhythm + Regie auto-pilot. Replaces hard-coded cadences with composable triggers; structural unlock for the SaaS pivot.
- [ ] **Embeddable "Get a Quote" widget** _(M, 🚀)_ — Drop-in JS that creates inquiries directly in our KV via a tenant-scoped public endpoint. Source: HubSpot live chat / Pipedrive LeadBooster. Right architecture for SaaS multi-tenant lead capture; skips the email round-trip.
- [ ] **Multi-view on calendar/inquiries** _(M, 🍖🚀)_ — Calendar / Board / List / Gantt over the same `events` array. Source: ClickUp pattern. `static/js/calendar.js` already returns the data; just needs a renderer per view.
- [ ] **BEO (Banquet Event Order) template system** _(M, 🍖🚀)_ — Custom fields per event-type (corporate ≠ wedding); `internal=true` flag so kitchen-only fields never render on customer view. Source: Toast EventView + Total Party Planner. PDF generator already exists; needs template variants.
- [ ] **Branded customer portal per event** _(M, 🍖🚀)_ — Single share-URL where customer sees current proposal, e-signs, pays deposits, submits change requests, chats with operator. Same chrome as operator BEO view. Source: Toast EventView / TPP client portal.
- [ ] **Pre-built catering automation flow templates** _(M, 🍖🚀)_ — Bake in canonical sequences as defaults: inquiry → quote → 48h follow-up → deposit reminder → 1-week confirm → event-day brief → post-event review. Source: Klaviyo flow library + ClickUp templates. Operator one-click enables; AI fills variables.
- [ ] **`Refund` + `Dispute` + `CreditMemo` entities** _(M, 🚀)_ — First-class records with `original_payment_id`, `amount`, `reason`, `status`, `processor_refund_id` / `evidence_due_by`. Source: Stripe data model. Required at SaaS scale and for any cancellation flow.
- [ ] **Top-level `customer:{id}` record** _(M, 🚀)_ — Promote customer out of inquiry-denormalized state. Fields: `lifetime_value`, `tax_exempt_certificate_url`, `default_terms`, `tags[]`, `threads[]` back-ref. Source: Stripe Customers + Salesforce Accounts.

## Tier 3 — Larger builds (Wave 7+ or SaaS pivot phase)

These are >1 week builds; some are defining differentiators.

- [ ] **Auto-generated kitchen prep sheet aggregating multi-events same day** _(L, 🍖🚀)_ — Group recipes by station (smoker / cold prep / sauce), subtract on-hand inventory, add buffer percentage, print station-by-station. Source: Total Party Planner's killer feature. Major operator time-saver; structural differentiator vs generalist tools like Toast.
- [ ] **Pack list auto-generated from menu items** _(L, 🍖🚀)_ — Item → packing-requirement mapping (X half-pans, Y serving utensils, Z chafing setups). Source: TPP. Extends the menu data model; pairs with the Event entity.
- [ ] **Voice-AI inbound phone answer** _(L, 🍖🚀)_ — Vapi orchestration + Twilio + Claude Haiku + Deepgram STT + ElevenLabs TTS. Tools: `check_calendar`, `save_inquiry`, `transfer_to_zach`. Caller-says-"human" → immediate transfer. Source: Vapi architecture; benchmarked vs Kea / ConverseNow / Slang. ~$0.13–0.30/min all-in; ~700-900ms latency. Off-hours killer feature for Blu's, headline pitch for the SaaS.
- [ ] **Voice-cloned email drafts grounded in Zach's Sent folder** _(L, 🍖🚀)_ — Train style prior on real sent mail; every claim must cite a source span. Source: extension of Lavender pattern. Solves AI SDR's "hallucinated congratulations" problem at the root.
- [ ] **Live food-cost / margin display while quoting** _(L, 🍖🚀)_ — Operator sees "you're at 38% food cost" inline as they build the quote. Source: catering-specific R365 / PeachWorks. Requires recipe cost data layer.
- [ ] **Multi-deposit schedule per event with ACH at ≤1%** _(L, 🍖🚀)_ — 25% / 50% / 25% milestones with deliberate ACH cost wedge on $5k+ deposits. Source: catering best practice + Stripe ACH pricing. Pairs with `payment_requests[]` data model.
- [ ] **Predictive next-event date for repeat customers** _(L, 🍖🚀)_ — Median-interval-since-last heuristic v1; pre-warm an inquiry 30 days before predicted date. Source: Klaviyo's predictive lifetime model. ML upgrade path later.
- [ ] **Customer-initiated change-request flow** _(L, 🍖🚀)_ — Customer submits change via portal; operator reviews-and-approves; quote regenerates. Source: CaterTrax. Reduces the "10-email back-and-forth" pattern that consumes catering ops time.
- [ ] **A/B variants per follow-up step with auto-winner promotion** _(L, 🚀)_ — KV counters + nightly p-value cron; operator-visible significance gating. Source: Outreach + Klaviyo. ~2-week build on existing scheduler.
- [ ] **Adaptive cadence (compress on engagement, pause+retone on silence)** _(L, 🚀)_ — Replaces fixed-schedule QStash sends. Source: Regie auto-pilot.
- [ ] **Two-channel coordination (email + SMS)** _(L, 🍖🚀)_ — SMS only fires when email opened-but-not-replied for 36h. Source: SEP industry standard. `api/sms/` scaffold already exists.
- [ ] **Per-tenant guardrails for SaaS pivot** _(L, 🚀)_ — Daily send caps, per-domain throttles, bounce-rate alerts, spam-complaint kill switch, opt-out enforcement. Source: Outreach/Salesloft deliverability lessons. **Required day-1 if multi-tenant outbound opens.**
- [ ] **Recipe → station mapping** _(L, 🍖🚀)_ — Each prep recipe knows its station; prints as separate kitchen sheets. Source: catering-specific data model.
- [ ] **Visual flow builder over QStash scheduler** _(L, 🚀)_ — Flow-graph UI ("trigger → wait 1 day → send → branch on reply") on top of existing scheduler primitive. Source: Klaviyo flows / ClickUp automations.
- [ ] **Stripe Connect for tenant payouts** _(L, 🚀)_ — Each tenant's deposits land in their own connected account; we take platform fee. Source: Stripe Connect. Required for the SaaS pivot's payment story.
- [ ] **Event Areas / capacity blocking** _(L, 🍖🚀)_ — Define smoker capacity, dining-room capacity, delivery-van capacity to prevent same-Saturday double-bookings. Source: Toast Pro tier. Pairs with the Event entity.
- [ ] **Customer health scoring with colored kanban edge strip** _(L, 🍖🚀)_ — Nightly cron computes per-inquiry score (deposit-paid, last-contact recency, sentiment, calendar-distance). Renders as red/yellow/green left-edge strip on kanban cards with hover-reason. Source: Gong deal-card risk strip + Einstein opportunity scoring.
- [ ] **Pinned annotations on PDF quotes** _(L, 🍖🚀)_ — Draw on the PDF, comment-thread per pin. Source: ClickUp creative proofing. Beats the current "thumbs-up the whole draft" flow in `chat-approval.js`.
- [ ] **Real-time event-driven segmentation** _(L, 🚀)_ — Codify the activity log into an `events:{profile_id}` stream key in KV; segments become live predicates over events. Source: Klaviyo pattern. Foundation for cohort-based campaigns.
- [ ] **One-click prep-tools download bundle** _(L, 🍖🚀)_ — From any event: prep list + invoice + BEO + kitchen sheet + pickup summary + delivery summary + pack sheet + labels + CSV in a single zip. Source: Toast EventView. Data exists; surface doesn't.

---

## Suggested Wave assignments

To keep the ROADMAP intact, here's how the top picks slot into Wave structure:

### Wave 6 — Pipeline polish (proposed new wave)
- Kanban column $-totals + count
- Required fields at stage transition
- `viewed_at` / `opened_at` on quote PDFs
- Three-column inquiry detail view
- Unified activity timeline
- AI-output visual differentiator

### Wave 7 — Catering data model (proposed new wave)
- First-class `Event` entity
- BEO template system
- `payment_requests[]` on invoices
- Per-line `tax_rate` + `tax_code`
- `hooks[]` array on inquiry
- `Refund` + `Dispute` + `CreditMemo` entities
- Top-level `customer:{id}` record

### Wave 8 — AI assist (proposed new wave)
- Reply-likelihood scorer in email composer
- Inline coaching with span-level suggestions
- At-risk inquiry monitor
- Hybrid deal-likelihood score with explainability
- Daily 7am "what the AI did" digest
- Voice-cloned email drafts grounded in Sent folder

### Wave 9 — Operations differentiators (proposed new wave)
- Auto-generated kitchen prep sheet
- Pack list auto-generated from menu items
- Recipe → station mapping
- Branded customer portal per event
- Customer-initiated change-request flow
- Live food-cost / margin display while quoting
- One-click prep-tools download bundle

### Wave 10 — SaaS pivot prerequisites
- Embeddable "Get a Quote" widget
- Hosted invoice URL + saved-card autocharge
- Stripe Connect for tenant payouts
- Per-tenant guardrails (deliverability, caps, throttles)
- Signal → Action router
- Pre-built catering automation flow templates
- Multi-view on calendar/inquiries

### Future / experimental (no wave yet)
- Voice-AI inbound phone answer
- Visual flow builder over QStash
- Real-time event-driven segmentation
- A/B variants with auto-winner promotion
- Adaptive cadence

---

_Cross-references: full strategy in `00-summary.md`; per-competitor research in `01-salesforce.md` through `21-voiceflow-vapi.md`._
