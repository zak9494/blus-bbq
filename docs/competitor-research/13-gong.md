# Gong.io

> Conversation intelligence + revenue AI platform. Recognized as a Leader in the 2025 Gartner
> Magic Quadrant for Revenue Action Orchestration. The category-defining incumbent — every
> competitor positions either with or against Gong.

## A. Core value prop

Gong records, transcribes, and analyzes every customer-facing call, email, and meeting,
then layers ML on top to surface deal risk, coach reps, and forecast pipeline. The promise:
"the truth of what's actually happening in your deals" instead of CRM-stage opinion.

## B. Top 5 features worth copying

1. **AI Deal Monitor — at-risk-deal warnings.**
   Gong continuously watches each deal for unusual activity or *inactivity* and emits
   risk warnings ("no buyer reply in 9 days," "champion went silent," "no exec engaged
   yet at this stage"). For Blu's BBQ, the equivalent is a Claude-powered cron that scans
   each inquiry's last activity, expected event date, and reply gap, then writes a
   ranked alert list. We already have `api/pipeline/alerts.js` — copy Gong's *category
   taxonomy* (silence / champion-loss / unaddressed-objection / single-threaded) and
   apply it to catering inquiries (silence / no-deposit / event-this-week-no-confirmation
   / quote-sent-but-not-opened).

2. **Deal Likelihood Score — hybrid 50/50 model.**
   "50% conversation signals, 50% activity + contacts + timing + history." The weighting
   is *learned per deal*, not a fixed rule, and retrains daily on closed-won/lost
   outcomes. SaaS pivot: when we have enough closed inquiries, train a small classifier
   on (lead-source, time-to-first-reply, quote-revisions, deposit-status, days-to-event,
   reply-sentiment) and surface a `likelihood: 0..100` per inquiry. v1 can be heuristic
   weights, v2 uses Claude to summarize signals, v3 swaps in a real model.

3. **Activity Timeline + Color-Coded Engagement.**
   Every email, call, meeting, and CRM event for a deal in one chronological strip,
   color-coded by who acted (rep vs buyer) and whether engagement is rising or falling.
   This is the killer UI — see section C. We can implement this trivially: inquiries
   already have an `activity` log; render it as a vertical timeline on the inquiry
   detail page with buyer-action vs Blu's-action color stripes.

4. **AI Composer — email drafted from real conversation context.**
   Gong's Composer drafts replies that reference *what was actually said* in prior calls
   and emails. We already do this with `api/inquiries/draft-email.js` + Claude. The copy
   target is the *grounding* discipline: every drafted email shows tooltips that link
   each claim back to the source message ("you mentioned 200 guests on 4/15"). This kills
   the hallucination anti-pattern (section G).

5. **Deal Boards — kanban with AI-driven sorting.**
   Pipeline kanban where columns are stages but the *order within a column* is set by
   AI risk score and time-decay, not manual drag. Highest-priority deal floats to the
   top of the column automatically. Our pipeline page (`#page-pipeline`, lines 639–712)
   has the bones; add a `aiSort=true` toggle that orders cards by `riskScore *
   daysUntilEvent`.

## C. Notable UI patterns

- **Call timeline view.** Horizontal scrubber across a recorded call: speaker tracks
  stacked vertically, color blocks for "talking," red dots for objections, blue dots
  for next-steps mentioned, yellow for competitor mentions. Click any dot to jump to
  that moment in the transcript. **Adapt for catering:** email-thread timeline with
  dot annotations — "guest count given," "date confirmed," "price objection,"
  "deposit asked" — clickable to scroll to the message.

- **Deal board cards with risk strip.** Each kanban card has a thin colored strip on
  the left edge: green/yellow/red. Hover reveals the *one-sentence reason* the AI
  flagged it ("no reply in 6 days"). Cheap to copy; high signal density.

- **Activity timeline as scrubbable horizontal strip** (not a vertical feed). Buyer
  actions above the line, rep actions below; spacing reflects real time elapsed. Gaps
  in the timeline are visually obvious — "this deal went silent for 11 days" jumps
  out instantly.

- **"Why this score?" expandable panel.** Click any AI score and get a list of the
  contributing signals with weights, in plain English. Builds trust; if we drop this,
  the score feels like a black box and reps stop trusting it.

- **Talk-ratio donut + monologue length bars.** For calls. Less relevant to email-only
  catering, but the principle (*one glanceable health metric per artifact*) is worth
  stealing for emails: "reply within 2h 80% of the time" badge on the customer card.

## D. Data model insights

| Concept | Shape | Catering analog |
|---------|-------|-----------------|
| Deal | id, accountId, stage, amount, closeDate, ownerId, riskScore, scoreReasons[] | Inquiry (`inquiries:{threadId}`) — already have most fields |
| Activity | dealId, type (call/email/meeting/cal-event), timestamp, direction (in/out), participantIds[], summary, signals[] | Already in inquiry `activity[]`; add `signals[]` array |
| Signal | dealId, type ("objection","next-step","competitor","price"), confidence, sourceActivityId, snippet | NEW — Claude can extract these per email |
| Score | dealId, value, computedAt, contributors[{factor, weight, direction}] | NEW — derived; cache for ~6h |
| Topic | name, mentions[{activityId, timestamp, snippet}] | NEW — "deposit," "menu," "delivery," "headcount" |
| Watchlist | userId, dealIds[], reason | Map to "starred inquiries" — trivial KV addition |

The key insight: **signals are first-class objects, extracted from conversation, not
typed by reps.** Claude can populate `signals[]` on every inbound email at zero
incremental cost. That's our wedge — Gong does this for $1,600/seat/year; we can
match the *output* for solo operators.

## E. Integration ecosystem

- **CRM:** Salesforce (deepest), HubSpot, Microsoft Dynamics. Two-way sync of accounts,
  opportunities, activities.
- **Email:** Gmail + Outlook (OAuth, identical to ours).
- **Calendar:** Google Calendar + Outlook Calendar — auto-records meetings, joins as a
  bot.
- **Conferencing:** Zoom (deepest), Microsoft Teams, Webex, Google Meet — auto-record.
- **Dialer:** Native dialer in Engage; integrates with Aircall, RingCentral, Dialpad.
- **Slack:** real-time deal alerts, "deals at risk" digest, share call clips.
- **BI/data:** Snowflake, BigQuery for raw event export (enterprise tier).
- **Marketplace:** ~100+ apps, OpenAPI for custom connectors.

For our purposes the relevant subset is Gmail + Google Calendar + Slack — all of which
we either have or could add cheaply. Slack alerts on at-risk inquiries is a 1-day build.

## F. Pricing model

Not public; sales-led only. From multiple 2026 third-party breakdowns:

- **Gong Foundations (base):** ~$1,600/user/year list, negotiated to $1,000–$1,349.
- **Bundle (Core + Engage + Forecast):** $2,880–$3,000/user/year ($240–250/mo).
- **Mandatory platform fee:** $5,000–$50,000/year on top, regardless of seats.
- **Implementation:** $7,500–$15,000 (small), up to $65,000+ (enterprise). Mandatory.
- **Auto-renewal uplift:** 5–10%/year.
- **Effective per-user cost at 25 seats Y1:** ~$4,000/user once platform fee +
  implementation are amortized. At 150 seats: ~$3,283/user.
- **Contracts:** 2–3 year typical.

Translation: **a 5-person catering team would never afford Gong.** Our SaaS pivot can
price the *patterns* at $49–$149/seat/month and still feel premium. We are not
competing with Gong on enterprise features; we are competing on *the same UI patterns
priced for SMB ops*.

## G. Anti-patterns

1. **"Surveillance theater."** The dominant complaint in r/sales and G2: "weird vibe
   where everything's being tracked and scored — talk time, keywords, objections."
   When deployed by a manager who uses Gong for PIPs, reps disengage or stop having
   real conversations. **Lesson:** frame our equivalents as *coaching for the operator*,
   not *audit trails for a boss*. Single-operator tool by design avoids this entirely;
   if we add multi-user, default the dashboards to "personal coaching mode" and require
   an explicit toggle to enable team-level visibility.

2. **Inaccurate transcription, then confident summaries built on top.** Gong's whisper
   models still mishear domain jargon; the AI summary then propagates the error
   confidently. **Lesson:** every Claude-generated artifact must cite source spans.
   Never let a summary appear without a "source" tooltip.

3. **Consent burden pushed entirely to the customer.** Gong gives you "consent tools"
   but you own jurisdiction-specific lawful basis, ongoing consent, withdrawal,
   employment-law compliance for internal recordings. **Lesson:** if we ever add call
   recording, ship a *default-on* spoken consent prompt and a per-state consent matrix
   — don't treat it as the operator's problem.

4. **Pricing opacity.** "Talk to sales" + 2-year contract + auto-uplift is the SaaS
   anti-pattern that reps universally hate. **Lesson:** publish pricing. Even "$49 /
   $149 / contact us" beats "all gated."

5. **Mandatory implementation services.** Gong charges $7.5k–$65k for setup that other
   tools self-serve. **Lesson:** if our catering SaaS needs hand-holding, that's a
   product bug, not a revenue line.

6. **AI score with no "why."** Black-box scores without contributor breakdown destroy
   trust. **Lesson:** every score we ship has a "why this score?" expandable.

---

**Sources**
- [Gong — Conversation Intelligence](https://www.gong.io/conversation-intelligence)
- [Gong — Under the hood of deal likelihood scores](https://help.gong.io/docs/explainer-under-the-hood-of-deal-likelihood-scores)
- [Gong — AI Deal Monitor](https://help.gong.io/docs/understanding-ai-deal-monitor)
- [Gong — Deal Boards](https://help.gong.io/docs/understanding-deal-boards)
- [Gong Engage — Sales Engagement](https://www.gong.io/platform/sales-engagement-software)
- [Gong G2 reviews](https://www.g2.com/products/gong/reviews)
- [Gong Pricing 2026 breakdown — MarketBetter](https://www.marketbetter.ai/blog/gong-pricing-breakdown-2026/)
- [Gong Pricing Guide — tl;dv](https://tldv.io/blog/gong-pricing/)
- [Gong Reviews: Good/Bad/Ugly — Sybill](https://www.sybill.ai/blogs/gong-reviews)
- [Trust and Security at Gong](https://www.gong.io/platform/trust)
