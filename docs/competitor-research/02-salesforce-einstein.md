# Salesforce Einstein / Agentforce

The AI layer on top of Salesforce. Renamed in waves: Einstein → Einstein Copilot → Agentforce. Same product, mostly. Worth studying because Salesforce has spent the most money trying to figure out "what is AI useful for inside a CRM" — their wins and (especially) their failures are instructive.

## A. Core value prop

Einstein/Agentforce promises CRM-native AI that scores leads, forecasts revenue, drafts emails, captures activity automatically from Gmail/calendar, and (with Agentforce) runs autonomous multi-step agents grounded in your CRM data. The pitch: AI that *knows your customers* because it lives where the customer data lives.

## B. Top 5 features worth copying

1. **Einstein Lead Scoring with "top reasons."** Each lead gets a 1-99 score, and the UI shows the top 3 features that drove the score (e.g., "+12 because industry matches converted leads", "−8 because no email engagement in 21 days"). The *explainability* is what makes it adopted — black-box scores don't get trusted. For Blu's BBQ: score each inquiry on conversion likelihood (event date proximity, headcount range, source signal, repeat-customer flag) and *show the reasons* on the inquiry card. This is a great Claude prompt: "Given this inquiry, return a 1-99 score and 3 short reasons."
2. **Einstein Opportunity Insights / Deal Insights — micro-nudges on the record.** Small contextual badges like "No reply in 7 days", "Email opened twice", "Close date pushed", "Stuck in stage 14 days." These aren't dashboards — they're inline nudges on the deal card. Cheap to implement (rule-based, doesn't require ML), high perceived value. Maps directly to pipeline-alerts.js — extend the rule set.
3. **Einstein Activity Capture — auto-log emails and meetings.** Connects to Gmail/Outlook/Google Calendar; every sent or received email and every accepted calendar event gets logged onto the related contact/opportunity timeline automatically, no manual logging. This is the single highest-leverage AI feature in any CRM, and the one users notice missing fastest. Blu's already has Gmail polling and Calendar sync — write the link layer that says "this email belongs to this inquiry, this calendar event belongs to this inquiry" and surface them on a unified timeline.
4. **Einstein Forecasting — AI-corrected pipeline numbers.** Reps' commits + AI-adjusted prediction with variance, trended over time. Catches "rep is sandbagging" or "rep is overcommitting." For a multi-shop catering SaaS, this is gold: each shop forecasts revenue from in-pipeline inquiries, AI corrects for historical close-rate by stage. For solo Blu's it's overkill v1, but the *concept* (probability-weighted pipeline value) is a single SQL query and worth surfacing.
5. **Einstein Trust Layer — masking, grounding, audit log.** Before any prompt hits the LLM, Einstein masks PII, grounds the prompt with retrieved CRM records, and logs the full input/output for audit. Toxicity check on output. Zero-retention agreement with the LLM provider. This is the *enterprise* AI bar and it's the thing that lets regulated customers say yes. For the SaaS pivot, having a "we don't ship your customer's PII to OpenAI" story matters even at the SMB level. Easy first version: redact emails/phones in Claude prompts using regex, log every prompt+response to KV for audit.

## C. Notable UI patterns

- **Einstein-branded UI surfaces are visually distinct.** Scores, insights, and recommendations are wrapped in a "starburst" icon and a subtle gradient background — users learn at a glance "this is AI, treat with appropriate skepticism." Matters because AI features mixed with deterministic ones erode user trust. Blu's should adopt the same — anywhere AI output is shown (extracted fields, drafted emails, scored leads), badge it with a recognizable AI marker.
2. **Inline copilot side-panel.** Agentforce Assistant lives as a right-rail chat panel that's *always available* on every record and pre-loaded with that record's context. Ask "summarize this opportunity" → it knows which one. Compare to Blu's chat UI which lives on its own page; pulling chat in as a per-record side panel is a high-leverage move.
3. **Prompt Builder / Einstein 1 Studio.** Low-code editor where admins write reusable prompts (like "Draft a follow-up email for this Opportunity") with merge fields from any object. The prompt becomes a button on the record. Self-modify already gestures at this; making *prompts* a first-class user-editable artifact (not code) lets ops customize tone without coding.
4. **"Why this score?" disclosure pattern.** Click a score → sidebar opens showing the contributing features ranked by weight. Sets the bar for explainable AI in CRM.
5. **Confidence indicators on extractions.** When Einstein extracts a field from an email, it shows confidence as a colored dot. Low-confidence values get a "Review" badge prompting human verification. Blu's Claude extraction does this binary (extracted or not); a confidence + review-needed state is more honest.

## D. Data model insights

Einstein bolts AI features onto Salesforce's existing object model rather than introducing new objects. Key additions:

- **`Einstein_*Score__c`** custom-ish fields on Lead and Opportunity — populated by Einstein, queryable like any field. Lesson: AI outputs should be *fields on the record*, not separate tables, so they show up in lists, filters, sorts, and reports for free.
- **`InsightAction` records** — small log rows representing each insight surfaced (and acknowledged/dismissed by user). Powers feedback loops ("user dismissed this insight" → demote that pattern).
- **Einstein Activity Capture** uses a separate `EmailMessage` + `Event` model that lives outside the standard activity timeline initially — this caused user confusion ("why don't I see captured emails in reports?"). Lesson: don't shadow-table your AI-derived data; merge it into the canonical activity stream from day one.
- **Data Cloud / Einstein 1** introduces a separate "lakehouse" data layer for unifying multi-system records (Salesforce + external CRMs + product telemetry). Mandatory for Agentforce — and a hard sell because it requires re-modeling. Lesson for SaaS pivot: don't build a second data model for AI; ground prompts directly in your primary store.

**What Blu's data model needs to add for AI features:**
- `score`, `score_reasons[]`, `score_updated_at` on each inquiry record (cheap, immediate value).
- `insights[]` on each inquiry: array of `{type, severity, body, dismissed_at}` — drives the nudge pattern.
- A unified `customer_activities` table (covered in 01-salesforce.md) is the *substrate* for any AI summary feature — without it, "summarize this customer" can't work.

## E. Integration ecosystem

Einstein is bundled inside the Salesforce platform; integrations are the same as Salesforce proper (AppExchange, REST API, etc.). The new wrinkle:

- **MuleSoft** (Salesforce-owned iPaaS) — for grounding agents in non-Salesforce data sources at scale.
- **Slack** — Agentforce agents are exposed as Slack bots with first-class deployment from the Agent Studio.
- **OpenAI / Anthropic / Google** — Einstein is model-agnostic via the Trust Layer; customers can choose providers. Lesson: model abstraction layer (provider-agnostic — same pattern as Blu's payment-provider abstraction in CLAUDE.md) is the right architecture. Don't hard-code Claude.
- **Data Cloud connectors** for Snowflake, Databricks, BigQuery, S3.

## F. Pricing model

Aggressively expensive and structurally confusing:

| SKU | Price | Includes |
|-----|-------|----------|
| Sales Cloud Einstein (legacy add-on) | $50/user/mo | Lead/Opp scoring, basic insights |
| Einstein for Sales (newer bundle) | bundled in Enterprise+ | Activity Capture + scoring |
| Agentforce add-on | ~$125/user/mo | Conversational agent, unlimited gen-AI usage |
| Agentforce 1 (top tier) | ~$500–$650/user/mo | Includes core CRM + AI + ~1M Flex Credits |
| Agentforce conversational pricing | $2/conversation | Consumption — surprise-bill risk |
| Data Cloud (prerequisite) | $50–$150/user/mo extra | Mandatory for Agentforce |

No free tier. No light/per-feature option. Buyers report effective AI costs of $300–$700 per seat per month all-in.

**Key insight for SaaS pivot:** AI pricing is hard. Pure consumption surprises customers; flat per-seat over-charges low users. The right model for catering ops is probably *flat per shop* with a generous-but-bounded usage envelope (e.g., 500 AI extractions / 200 drafts per month included, hard cap or pay-per-use beyond), so the bill is predictable.

## G. Anti-patterns — DO NOT COPY

1. **5.3% adoption rate.** Agentforce adoption sits at ~5%. The product is sold but not used. Cause: complexity of setup + data quality requirements (see #2) + unclear ROI per feature. Don't ship AI features that require a 6-week implementation to turn on.
2. **AI failure mode = data quality.** 77% of B2B Agentforce deployments fail due to dirty data. Hallucination rates range 3-27% based on data cleanliness. Lesson: ship data-quality tooling *with* the AI — duplicate detection, required-field nudges, freshness indicators — or AI features will visibly fail in front of users.
3. **Naming chaos.** Einstein → Einstein Copilot → Agentforce → Agentforce Assistant → Agentforce 1 → Einstein 1 Studio. Five renames in two years. Customers can't tell what they bought. Pick a name and stick to it.
4. **Pricing layer-cake.** Sales Cloud + Einstein add-on + Data Cloud + Flex Credits + per-conversation overages = no one knows what their bill will be. The single biggest reason customers churn off AI features. Bundle predictably.
5. **AI features locked to Enterprise+ tier.** Small customers can't try the AI without committing to $165/seat first. Anti-PLG. Make AI features available (rate-limited) on the cheapest tier.
6. **Hallucination disclosure is buried.** Marketing says "won't hallucinate"; reality is 3-27%. Be honest in-product: "AI-generated. Verify before sending." Especially for outbound communications (Blu's emails go to real customers; one hallucinated event date burns a customer permanently).
7. **Mandatory Data Cloud as prerequisite.** Forcing customers to re-platform their data into a new lakehouse before they can use AI is the textbook anti-pattern of "boil the ocean to ship a feature." Ground prompts in your primary store.
8. **Pre-built agent templates that nobody uses.** Agentforce ships dozens of "out-of-the-box agents" (SDR Agent, Service Agent, Coaching Agent) — most have <1% activation. Better to ship *one* agent that solves *one* concrete problem and works end-to-end (e.g., "draft response to inquiry" — done well, this is the entire ROI for a catering CRM).

Sources:
- [Salesforce Einstein for Sales (Oliv.ai)](https://www.oliv.ai/blog/salesforce-einstein-for-sales)
- [Einstein Lead/Opp Scoring (Salesforce Ben)](https://www.salesforceben.com/what-is-salesforce-einstein-opportunity-scoring/)
- [Practical Map of Einstein (Medium)](https://medium.com/@shirley_peng/a-practical-map-of-salesforce-einstein-for-leads-opportunities-9133e9f758d5)
- [Agentforce vs Einstein 2026 (Clientell)](https://www.getclientell.com/salesforce-blogs/salesforce-agentforce-vs-einstein-the-definitive-2025-comparison-guide)
- [Einstein Trust Layer (Trailhead)](https://trailhead.salesforce.com/content/learn/modules/the-einstein-trust-layer/meet-the-einstein-trust-layer)
- [Hallucination data quality (GPTfy)](https://gptfy.ai/blog/prevent-ai-hallucinations-in-salesforce)
- [Agentforce pricing (Salesforce Negotiations)](https://salesforcenegotiations.com/salesforce-einstein-gpt-copilot-and-ai-cloud-pricing/)
