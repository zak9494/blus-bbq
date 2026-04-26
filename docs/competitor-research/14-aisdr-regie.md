# AiSDR + Regie.ai

> Two leaders in the "AI SDR / autonomous prospecting" category. Both promise to replace
> or augment human SDRs by sourcing leads, drafting personalized outreach, and running
> multi-channel sequences end-to-end. Regie.ai is older and now rebranded around
> "RegieOne" / Auto-Pilot Agents; AiSDR is newer and pushes a hard agentic angle with
> 323+ real-time signals.

## A. Core value prop

**Regie.ai:** "World's first AI Sales Engagement Platform" — Auto-Pilot Agents act as
virtual SDRs, sourcing ICP leads, generating multi-channel sequences (email + phone +
LinkedIn), and adjusting timing/channel/messaging in real time as engagement signals
fire. Pitched as an SEP that replaces Outreach/Salesloft, not just augments.

**AiSDR:** Fully autonomous AI sales agent that runs every stage of outbound — finds
high-intent prospects, holds two-way email + LinkedIn conversations, generates call
scripts for human dialers — and analyzes 323+ signals per recipient (online behavior,
recent role changes, public activity, decision-making style, tone-of-voice priors) to
hit "1-to-1" personalization at scale.

## B. Top 5 features worth copying

1. **Signal-triggered outreach (job change, website visit, intent spike).**
   Both products listen for *behavioral signals* — recipient changed jobs, visited
   pricing page, opened an email twice, posted on LinkedIn about a relevant topic —
   and trigger the next sequence step *immediately* instead of on a fixed cadence.
   For catering: trigger a Claude-drafted follow-up the moment an inquiry replies, the
   moment a quote PDF is opened, or the moment the event date crosses inside a
   "deposit-due" window. We already have most of these signals (email opens, replies,
   calendar events) — just wire them into a *signal → action* table.

2. **Auto-pause / auto-resume on engagement spikes.**
   RegieOne literally adjusts cadence as engagement spikes or fades. Translate to
   catering: if customer replies fast and warm, *compress* follow-ups (next message in
   2h, not 2 days); if they go silent for 5 days, *pause* and switch from
   "scheduling" tone to "checking in" tone. Cadence is *adaptive*, not fixed steps.

3. **Per-recipient signal stack feeding the LLM prompt.**
   AiSDR's headline number — "323+ signals per prospect" — is mostly marketing, but
   the underlying pattern is right: the LLM prompt is built by *concatenating*
   structured facts (job title, company size, last LinkedIn post, last reply
   sentiment, prior order history, dietary restrictions mentioned, headcount said) so
   the email reads as 1:1. For us: every Claude prompt for an inquiry email should
   pull from the inquiry record + repeat-customer data + last 3 thread messages, and
   the prompt should explicitly list "facts you may reference" so it can't hallucinate
   ones it wasn't given.

4. **Multi-channel coordination (email + LinkedIn + call script generation).**
   Both products coordinate channels: an email lead-in, then a LinkedIn touch the next
   day, then a call script the rep dials manually. For catering: email + SMS
   (`api/sms/` already scaffolded) coordinated through one `sequence` engine. SMS only
   fires when email opened-but-not-replied for 36h. Call script (we don't dial, but a
   *talking-points card* for Zach when he calls a customer) is a free win.

5. **Two-way email handling — agent replies on behalf of human.**
   AiSDR holds two-way conversations autonomously (with a kill-switch). We absolutely
   should NOT auto-send for catering (see anti-pattern #1). But we *should* draft a
   reply the moment a customer responds and queue it in the chat-approval queue
   (`api/chat/approval.js` is the right home). One click → send. The pattern: AI
   composes, human approves with a single tap. That's the right balance for a
   bootstrapped solo operator.

## C. Notable UI patterns

- **Sequence editor as a vertical step list with channel icons.** Each step is
  numbered, has a channel pill (email / call / LinkedIn / SMS), the body preview
  inline, and edit-in-place. Branching ("if reply → exit; if open-no-reply → step 4b")
  is shown as an indented sub-block, not a separate canvas. **Why it's good:** lower
  cognitive load than Outreach's full canvas (section 16). For catering — where
  sequences are short (5–7 steps max from inquiry → quote → deposit → confirm → event
  → review request) — vertical stepper is the right primitive.

- **Per-prospect "research card."** Avatar, role, company, recent LinkedIn post
  preview, ICP fit score, signals fired in the last 30 days. One-glance context
  before the rep ever speaks to the lead. Translate to catering: an inquiry detail
  panel that shows last-known event date, party size, dietary notes, prior orders,
  prior deposit history, days-since-last-contact — without scrolling.

- **Auto-Pilot dashboard — "what the AI did today."** Daily digest: emails drafted,
  emails sent (after approval), prospects added, signals detected, meetings booked.
  Builds operator confidence by making the agent's actions auditable. We need this:
  one page that lists every Claude action in the last 24h, link to source. We have
  `modify-history` for self-modify; mirror it for outbound.

- **Inline confidence bar on every drafted message.** "85% confident this matches your
  voice" — a thin sentiment/match bar. The pattern lets the operator decide whether to
  trust-and-send or rewrite.

## D. Data model insights

| Concept | Shape |
|---------|-------|
| Prospect / Lead | id, email, name, company, title, icpScore, signals[], enrichmentSources{linkedin,clearbit,...}, segment |
| Signal | prospectId, type ("job-change","page-visit","email-open","linkedin-post","funding-round"), payload{...}, firedAt, weight |
| Sequence | id, name, ownerId, steps[], exitCriteria{onReply,onMeetingBooked,onUnsubscribe} |
| Step | sequenceId, order, channel ("email"\|"call"\|"linkedin"\|"sms"), waitDays, branchRules[], templateId, abVariantId? |
| Touchpoint | sequenceRunId, stepId, prospectId, sentAt, channel, status ("sent","opened","replied","bounced","unsubscribed"), payload |
| SequenceRun | sequenceId, prospectId, currentStep, status ("active","paused","completed","exited"), exitReason |
| Variant | stepId, version ("A","B"), template, sampleSize, replyRate |
| AgentAction | runId?, prospectId, action ("drafted","sent","paused","added-to-sequence"), reasoning, sources[], approvedBy?, approvedAt? |

Key adaptations for our codebase:
- `Sequence` already aligned with QStash + `/api/schedule` — we have the queue
  primitive, just need the sequence definitions in KV.
- `Signal` is the new abstraction we should add. Cron + webhook handlers write rows;
  the sequencer reads them as triggers.
- `AgentAction` mirrors our `modify-history` audit log — same pattern, applied to
  outbound instead of self-modify.

## E. Integration ecosystem

- **CRM:** HubSpot (both — AiSDR has native two-way), Salesforce (both), Pipedrive
  (Regie).
- **Email:** Gmail + Outlook + custom SMTP.
- **LinkedIn:** Sales Nav scraping (gray-area; Regie touts deeper integration).
- **Dialers / phone:** Aircall (AiSDR), Outreach/Salesloft replacement claims (Regie).
- **Data enrichment:** Apollo, ZoomInfo, Clearbit, LinkedIn — pulled into the prospect
  research card.
- **Calendar:** Google + Outlook for meeting booking links.
- **Slack:** alerts on replies and meetings.
- **Webhooks:** standard for downstream automation.

For our pivot: Gmail + Google Calendar (have), HubSpot connector (medium build),
Slack (1-day build), Stripe/Square via our payments adapter — that's the integration
surface a small catering operation needs.

## F. Pricing model

**Regie.ai:**
- AI SEP starts at **$180/user/month** (~$2,160/user/year).
- "Force Multiplier Rep" tier: **$499/user/month** (~$5,988/user/year, annual contract).
- RegieOne enterprise: contact sales.
- Implementation often **$5,000–$150,000**.

**AiSDR:**
- Starts at **$900/month** (quarterly contracts), **unlimited seats**.
- Annual plan: 20% discount.
- No public per-seat pricing — seat count is unlimited at the org tier.

For Blu's BBQ: both are wildly out of budget. AiSDR's "unlimited seats at $900/mo"
model is *closer* to where we should price our SaaS pivot — flat per-org pricing
($49–$199/mo) for a small catering team, no per-seat tax.

## G. Anti-patterns

1. **Auto-send hallucinated outbound.** The dominant criticism in r/sales: AI SDRs
   hallucinate facts ("congrats on your Series C" — there was no Series C), use
   formulaic ChatGPT openers, and prospects spot them instantly. Replies go to zero
   or worse, the domain gets blacklisted. **Lesson:** no fully-autonomous send for
   catering. AI drafts, human approves, single-click sends. The chat-approval queue
   pattern we already have is correct.

2. **"Robotic and salesy tone" — even with 323 signals, output reads as templated.**
   G2 reviews of Regie consistently flag the generated content as robotic.
   **Lesson:** keep the human voice in the system. Train Claude on *Zach's actual sent
   emails* (`gmail:tokens` + sent-folder ingestion) and use that corpus as the style
   prior, not generic "BBQ-friendly tone" prompts.

3. **Cookie-cutter "personalization" that fools nobody.** "Hi {first}, I noticed you
   {recent-LinkedIn-post-trimmed-to-60-chars} — would love to..." reads as a Mad-Libs.
   **Lesson:** if the AI doesn't have a *genuinely specific* hook (real prior order,
   specific menu request, real headcount), it should say nothing rather than fabricate
   a hook. Let the email be short and honest.

4. **Volume-driven domain damage.** Regie users have reported sending 1,400 emails
   for zero replies; Google/Yahoo bulk-sender rules now penalize >0.3% spam-marked
   rate. **Lesson:** for catering this risk is low (we send 10–50 emails/day, not
   1,400) but the principle holds — never let the AI escalate volume on its own.

5. **Pricing opacity in a "self-serve" category.** Regie hides RegieOne pricing
   behind sales while the cheaper tiers are public. Confusing. **Lesson:** publish
   one price grid; if enterprise needs a custom price, that's a separate "talk to
   us" link, not a fog-of-war.

6. **No kill-switch for autonomous mode.** AiSDR will keep replying on your behalf
   unless you explicitly disable. Several G2 reviews report the agent sending an
   embarrassing message that the operator only saw the next morning. **Lesson:**
   every autonomous loop needs a one-tap kill-switch on the dashboard, plus a daily
   summary email at 7am ("here's what the agent did").

---

**Sources**
- [Regie.ai homepage](https://www.regie.ai)
- [Regie — Auto-Pilot AI Agents](https://www.regie.ai/auto-pilot)
- [Regie — RegieOne](https://www.regie.ai/regie-one)
- [Regie.ai pricing](https://www.regie.ai/pricing)
- [Regie.ai G2 reviews](https://www.g2.com/products/regie-ai/reviews)
- [Regie AI pricing 2026 — Landbase](https://www.landbase.com/blog/regie-ai-pricing)
- [Regie.ai review — Salesrobot](https://www.salesrobot.co/blogs/regie-ai-review)
- [AiSDR homepage](https://aisdr.com/)
- [AiSDR pricing](https://aisdr.com/pricing/)
- [AiSDR G2 reviews](https://www.g2.com/products/aisdr-inc-aisdr/reviews)
- [AiSDR review — Coldreach (100+ reviews analyzed)](https://coldreach.ai/blog/aisdr-reviews)
- [Best AI SDR tools 2026 — MarketBetter](https://marketbetter.ai/blog/best-ai-sdr-tools/)
- [AI SDRs: What Works, What Fails — Prospeo](https://prospeo.io/s/ai-sdrs)
- [What's wrong with AI SDRs — Luru](https://www.luru.app/post/whats-wrong-with-ai-sdrs)
- [10 Things to Know Before You Deploy Your First AI SDR — SaaStr](https://www.saastr.com/10-things-to-know-before-you-deploy-your-first-ai-sdr-the-very-latest-with-saastrs-jason-and-amelia/)
