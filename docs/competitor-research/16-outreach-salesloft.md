# Outreach.io + Salesloft

> The two incumbents in "sales engagement platform" (SEP). Both started as
> cadence/sequence builders, both pivoted hard to AI-driven workflows after
> Gong + the AI-SDR wave. Salesloft merged with Clari (Dec 2025); Outreach
> doubled down on agentic AI ("Kaia"). For our purposes: SEP is the *category*
> our SaaS pivot competes in, with AI as the differentiator.

## A. Core value prop

**Outreach:** end-to-end sales execution platform — sequence builder, dialer,
deal management, forecasting, real-time AI assistant during calls (Kaia).
Pitched as "agentic AI that executes targeted actions across deals and
forecasting." Heavier, more complex, deeper branching logic.

**Salesloft:** modular Cadence + Conversations + Deals + Forecasting, now
unified under "Rhythm" (the signal-to-action engine powered by Conductor AI).
After the Clari merger, positions as "first global revenue workflow platform
for full-cycle sellers." Lighter touch, easier adoption, larger marketplace.

Both: outbound at scale + multi-channel cadences + AI-drafted email + call
analytics + forecasting.

## B. Top 5 features worth copying

1. **Cadence canvas with branching.**
   Outreach's core UI: a visual sequence canvas where steps branch on
   conditions ("if reply → exit"; "if open + no reply → wait 3d → step 4").
   For catering, our sequence is short but the branches are real: inquiry →
   if-replied-fast → quote-fast vs if-silent → nudge → if-still-silent →
   archive-with-followup-tag. Even a *simple* branching cadence editor (3
   exit conditions) would beat our current "schedule a single email" pattern.

2. **A/B test variants per step with auto-winner promotion.**
   Both Outreach and Salesloft let you run two subject-line variants on the
   same step; once one variant has statistically significant lift, the system
   promotes it as the new control. For us: when Zach has two quote-followup
   subject lines ("Your Blu's BBQ quote" vs "Quote inside — let me know"),
   the system A/Bs them across the next 50 sends and auto-promotes. This is a
   2-week build — KV stores variant counters, sequence engine picks weighted
   randomly, daily cron computes p-values.

3. **Rhythm / Conductor AI — signal-to-action queue.**
   Salesloft's Rhythm presents a *prioritized to-do list* per rep based on
   incoming signals. Not "here are 100 prospects to contact today" but
   "here are the 7 highest-leverage actions, in order, with the reason." For
   Zach as a solo operator: a daily "Today's 5 actions" panel, ranked by
   expected revenue impact (close-soon deposits > follow-ups > new inquiries
   > archived re-engagements). This becomes the *home screen* of the SaaS
   pivot.

4. **Kaia — real-time AI during calls (live coaching).**
   Outreach's Kaia listens to calls and surfaces talking points, competitor
   mentions, and objection-handling cards in real time. We don't do calls
   today, but the *pattern* — surface relevant facts the moment they're
   needed — applies to email too. When Zach starts replying to an inquiry, a
   sidebar shows "they asked about gluten-free in their last email; you
   haven't addressed it yet." That's a 3-day build with what we already have.

5. **Email throttling, warm-up, and deliverability monitoring.**
   Both platforms ship deliverability tooling: per-mailbox daily limits, ramp
   schedules, bounce monitoring, Google Postmaster integration, DKIM/SPF/DMARC
   guardrails. Critical for any outbound automation. For our SaaS pivot:
   even at low volume (10–50 sends/day per tenant), we need per-tenant daily
   caps, bounce-rate tracking, and an "are you SPF/DKIM correct?" health page.
   This is the difference between "doesn't ruin your domain" and "kills your
   business."

## C. Notable UI patterns

- **Cadence canvas (Outreach).** Step nodes connected by lines, branches as
  visible forks. Each node shows channel, day-offset, and edit-in-place body.
  Powerful but *harder to learn* — Outreach is consistently rated "more
  challenging to adopt" than Salesloft. **Our take:** vertical stepper
  (section 14) for v1, canvas only when sequences exceed ~6 steps.

- **Rhythm to-do queue (Salesloft).** Single column, ranked, every item has
  one primary action + one "skip / snooze." Each item shows the *reason it's
  here* ("page-visit signal fired 12m ago"). This is the right shape for a
  solo-operator dashboard. Steal it directly for our "Today" page.

- **Conversations replay grid.** Both platforms let managers scan a grid of
  recent calls, with talk-ratio bars, sentiment, and key moments. Less
  relevant for catering (no calls), but the *artifact-grid-with-mini-stats*
  pattern works for our inquiry list view too.

- **Deal cards with pipeline forecast indicator.** Each card shows close-
  probability + "moved/stalled/at-risk" pill. Color-coded. We have the
  pipeline kanban; add the pill.

- **Per-step analytics drill-down.** Click any step in a sequence and see
  open/reply/bounce per variant. Good defaults; good info density.

## D. Data model insights

The SEP data model is the most *standardized* of any in this research. Here
are the canonical entities:

| Concept | Shape | Notes |
|---------|-------|-------|
| Sequence (Outreach) / Cadence (Salesloft) | id, name, ownerId, isShared, steps[], settings{maxPerDay,timezone,exitOnReply} | Same thing, different name. |
| Step | sequenceId, order, channel, dayOffset, branchRules[], templateId, abVariantIds[] | |
| Touchpoint / Activity | sequenceRunId, stepId, prospectId, channel, sentAt, status, payload | Unit of "did X happen" |
| Prospect | id, email, name, company, ownerId, sequenceMemberships[], tags[], doNotContact | |
| Deal / Opportunity | id, prospectId, accountId, stage, amount, closeDate, ownerId, healthScore | |
| Account | id, name, domain, segment, ICP fit, signals[] | |
| Template | id, channel, subject?, body, variables[], ownerId, sharedWith |
| Variant | templateId, version ("A","B"), sampleSize, replyRate, sigP | |
| Signal (Salesloft Rhythm) | id, prospectId, type, payload, firedAt, weight, consumed | Routes to a Rhythm action |
| RhythmAction | id, ownerId, signalId, suggestedStep, reason, dueAt, status | The "today" queue |

**Key insight for us:** the `Signal → RhythmAction → Sequence` pipeline is the
abstraction our Claude-powered catering CRM should follow. Every event
(email-open, calendar-event-approaching, deposit-window-opening, customer-
hasnt-replied-in-N-days) becomes a `Signal`. A small router maps signals to
suggested actions. Some auto-execute (with approval); some show up as
"Today's tasks." This is the *mental model* worth stealing.

## E. Integration ecosystem

| Integration | Outreach | Salesloft |
|-------------|----------|-----------|
| Salesforce | deep, two-way | deep, two-way |
| HubSpot | yes | yes |
| Gmail | yes (OAuth) | yes (OAuth) |
| Outlook 365 | yes | yes |
| Calendar | Google + Outlook | Google + Outlook |
| Zoom | yes (call recording) | yes (Conversations) |
| Microsoft Teams | yes | yes |
| LinkedIn Sales Nav | yes (limited) | yes |
| Slack | alerts, deal updates | alerts, Rhythm digest |
| Marketplace size | ~100+ apps | ~260+ apps (larger) |
| Webhooks / API | full REST | full REST + GraphQL |
| Snowflake / BI | enterprise tier | enterprise tier |

For our SaaS pivot, the *minimum viable* integration set is: Gmail OAuth (have),
Google Calendar (have), Slack (~1 day), Stripe/Square (have via payments
adapter), HubSpot (1–2 weeks; not urgent for SMB catering). Skip everything
else for v1.

## F. Pricing model

Both opaque, sales-led, no public pricing. From 2026 third-party sources:

**Outreach:**
- List ~$100/user/month, real-world $150–$300 with add-ons.
- "Kaia" AI tier is an add-on, often $50–$80/user/mo on top.
- Annual contract; implementation typically $5k–$25k.
- Negotiations land 25–40% off list at scale.

**Salesloft:**
- Advanced tier ~$180/user/month list.
- Negotiated 35–45% off at scale.
- Implementation $5k–$25k.
- Larger marketplace adds value at the same effective price.

Both expensive enough that a 2-person catering shop would never adopt them
— and that's our pricing wedge. Catering ops at $49/$99/$199 with the same
*pattern surface* (signal-driven workflow, AI-drafted emails, kanban with
risk pills, daily action queue) is a defensible position.

## G. Anti-patterns

1. **Email deliverability damage at scale.** SEPs are the #1 cause of domain
   reputation crashes. Reps blast 100+ identical emails to a single domain;
   the receiving server flags as bulk; the domain enters a slow death spiral
   (open rates drop 20%, then 40%, then everything goes to spam). Google's
   2024 bulk-sender rules tightened this — >0.3% spam-complaint rate triggers
   penalties. **Lesson:** for our SaaS pivot, ship per-tenant daily caps,
   per-domain throttles, and bounce-rate alerts *from day 1*. Don't let any
   tenant nuke their own domain on our watch.

2. **Cadence over-tuning ("just add one more step").** Power users build
   17-step sequences with 4 levels of branching, then can't debug them.
   Reply rates collapse because the 17th touch is desperate-sounding.
   **Lesson:** cap our sequences at 6 steps. Force the operator to delete
   one before adding a 7th. Constraint as feature.

3. **Notification spam from Slack / mobile.** Every reply, every open, every
   meeting booked — by default both platforms fire a Slack alert. Reps mute
   the channel within a week, then miss real signals. **Lesson:** ship
   *digest* notifications by default (one Slack message at 9am with the
   day's actions), not real-time blasts. Real-time only for *exceptional*
   events (deposit failed, event 24h away with no confirmation).

4. **Generic AI-drafted email indistinguishable from any other SEP's
   AI-drafted email.** Recipients see ~20 of these per day; pattern-recognize
   them instantly. **Lesson:** train Claude on Zach's actual sent emails
   and use *his* phrasing as the prior. Voice is the moat.

5. **Steep onboarding tax.** Outreach in particular has a reputation for
   "took us 6 weeks to actually get value." For SMB catering, this is a
   non-starter. **Lesson:** sub-15-minute onboarding for our SaaS pivot —
   connect Gmail, paste a sample inquiry email, ship a quote — done.

6. **Forecast theater.** Both platforms produce forecast numbers that
   managers stare at but rarely action. **Lesson:** if we ship forecasting,
   tie every forecasted number to a *next action* the user can take.
   Numbers without actions are just dashboards.

---

**Sources**
- [Outreach.io vs Salesloft 2026 — Salesrobot](https://www.salesrobot.co/blogs/outreach-io-vs-salesloft)
- [Salesloft vs Outreach official comparison](https://www.salesloft.com/salesloft-vs-outreach)
- [Outreach vs Salesloft — Sera](https://blog.seraleads.com/kb/sales-tool-reviews/outreach-io-vs-salesloft-2026/)
- [Outreach vs Salesloft 2026 — Prospeo](https://prospeo.io/s/outreach-vs-salesloft)
- [Salesloft Rhythm — Conductor AI](https://www.salesloft.com/company/newsroom/salesloft-announces-rhythm-powered-by-conductor-ai)
- [Salesloft Rhythm Focus Zones](https://www.salesloft.com/platform/rhythm/focus-zones)
- [Salesloft signal-based selling press release](https://www.prnewswire.com/news-releases/salesloft-introduces-new-ai-powered-buyer-signal-based-selling-capabilities-302175099.html)
- [Outreach Email Deliverability Playbook](https://support.outreach.io/hc/en-us/articles/13186145285275-The-Outreach-Email-Deliverability-Playbook)
- [Why are my sequence emails going to spam — Outreach support](https://support.outreach.io/hc/en-us/articles/13552965539611-Why-are-my-sequence-emails-going-to-my-spam-folder)
- [Salesloft pricing 2026 — Landbase](https://www.landbase.com/blog/salesloft-pricing)
- [Outreach alternatives — Revenue.io](https://www.revenue.io/blog/the-10-best-outreach-alternatives-competitors)
- [Salesloft alternatives — Revenue.io](https://www.revenue.io/blog/the-12-best-salesloft-alternatives-competitors)
