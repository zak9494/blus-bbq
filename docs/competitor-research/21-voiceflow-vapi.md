# Voiceflow & Vapi (Voice-agent build platforms)

> Voiceflow and Vapi are the two leading platforms for *building* voice
> agents (rather than buying a vertical-tuned product). Voiceflow is
> visual/no-code-leaning, designed for cross-functional teams to design
> conversation flows together. Vapi is API-first, code-leaning, designed
> for engineers who want maximum configurability and BYO-model
> flexibility. Both have free or near-free entry tiers, both speak Twilio,
> both let you bring your own LLM/STT/TTS. For a solo dev building Blu's
> catering voice agent, Vapi is the closer fit.

## A. Core value prop

**Voiceflow:** "The operating system for AI customer experience" — visual
agent builder where designers, PMs, and engineers collaborate on
conversation flows, deploy across web/phone/messaging, and observe in
production. 10k+ live agents, 300k messages/min capacity.

**Vapi:** "The most configurable API to build leading voice AI products
and scale phone operations." API-native, 4,200+ configuration points, BYO
everything (LLM, STT, TTS, telephony), 300M+ calls processed, 500k+
developers.

## B. Top 5 features worth copying

1. **Streaming voice pipeline (both).** STT streams partial transcripts
   while the user is still speaking; LLM starts generating before STT
   finishes; TTS starts speaking before LLM finishes. Yields sub-700ms
   responsiveness instead of the naive 2s+ pipeline. *Rationale:* This is
   the table-stakes architecture pattern for any voice build we attempt.

2. **Tool calling natively wired to your APIs (both).** A flow node /
   assistant config registers your endpoints (`check_calendar`,
   `get_menu`, `save_inquiry`); the LLM decides when to call them.
   *Rationale:* This is exactly the bridge between voice agent and our
   existing serverless API — no new framework needed, just expose
   `api/inquiries/save.js` and friends as tools.

3. **Per-prompt A/B testing (Vapi).** Vapi can run two prompts in
   parallel-bucket on real traffic and report on outcome metrics.
   *Rationale:* Voice prompts are weirdly hard to evaluate offline;
   live A/B is the only honest test.

4. **Hallucination-detection test suite (Vapi).** Pre-deploy automated
   tests run synthetic conversations and flag when the agent makes up
   facts. *Rationale:* For Blu's, the failure mode is "AI promises a date
   we can't actually do." Worth investing in synthetic-test infrastructure
   from day one.

5. **Visual flow with global instructions overlay (Voiceflow).** The
   visual builder supports "agentic" mode where you write global LLM
   instructions instead of every node — flow nodes act as guardrails, not
   a full script. Best of both worlds. *Rationale:* For our use case,
   90% of the conversation is LLM freeform; the deterministic parts are
   "always confirm headcount and date before ending the call" — a global
   instruction is exactly the right primitive.

## C. Notable UI patterns

**Voiceflow:**
- **Drag-drop conversation canvas.** Nodes for speak, listen, branch,
  set-variable, call-API, end. Connectors visualize flow. Auto-layout on
  insertion.
- **Real-time tester pane** alongside the canvas — you type or speak, and
  the active node highlights as the conversation moves through it. Helps
  designers debug flow logic without deploying.
- **Knowledge-base panel** — drop in URLs, PDFs, or text and the agent
  RAG-queries them. Sits beside the flow canvas.
- **Dev / Staging / Prod environment toggle** at the top of the workspace.
  Promotion is a button click; rollback is a button click. Critical for
  voice work where a bad deploy is audible.
- **Analytics / Observability tab** with conversation list, transcript
  drilldown, drop-off heatmap, custom evaluation rubrics.
- **Roles & permissions** — designer can edit flows, viewer can only watch
  conversations, dev controls deploys.

**Vapi:**
- **Assistant config as JSON** (with a UI form on top). Versioned. Diffable.
  Forkable.
- **Live call monitor** in the dashboard — watch in-progress calls, see
  the streaming transcript and tool calls, intervene.
- **Tool registry UI** — register a webhook URL + JSON schema for params;
  Vapi auto-generates the tool definition for the LLM.
- **Voice-tuning sliders:** stability, similarity, style for ElevenLabs
  voices, audible-preview button so you can iterate on tone in seconds.
- **Latency timeline view** for each completed call: STT 240ms, LLM 410ms,
  TTS 120ms, etc. Lets you see exactly where to optimize.

## D. Data model insights

**Voiceflow** is flow-graph-centric:
- **Project** → **Workflow** → **Block** (Step). Blocks are the atomic
  units (Speak, Listen, Capture, Choice, Set, API, Condition, GoTo).
- **Variables** are scoped: turn (one exchange), session (one call),
  user (persistent across calls).
- **Knowledge Base**: ingested documents chunked + embedded for RAG.
- **Versioning** at the project level — you can roll back the entire flow.

**Vapi** is assistant-centric:
- **Assistant**: `{ id, name, model, voice, transcriber, system_prompt,
  tools[], first_message, metadata }`. Composable: an assistant references
  voice + model + tools by ID.
- **Tool**: `{ name, description, parameters_schema, server_url,
  async }`. The LLM sees the schema; Vapi handles the HTTP call.
- **Call**: `{ id, assistant_id, phone_from, phone_to, status, started_at,
  ended_at, transcript, recording_url, summary, structured_data }`.
- **Squad**: a group of assistants that can hand off to each other
  mid-call (e.g., booking-bot transfers to billing-bot).
- **Webhook events**: `call-started`, `call-ended`, `tool-call`,
  `transcript-update`. Subscribe and integrate however you want.

For a Blu's BBQ voice agent on Vapi, the data model maps:
- One main `BluCateringAssistant` with system prompt embedding our menu,
  pricing rules, and lead-time expectations.
- Tools: `check_date_available`, `lookup_repeat_customer`,
  `save_catering_inquiry`, `transfer_to_zach`.
- Each call → on hangup, Vapi's webhook hits a new
  `api/voice/call-ended.js` that creates the inquiry record.

## E. Integration ecosystem

**Voiceflow (40+ integrations):**
- LLMs: OpenAI, Anthropic, Gemini, Llama, custom endpoint.
- Channels: Web widget, phone (via Twilio), WhatsApp, Slack, Microsoft
  Teams, custom HTTP.
- Business: Salesforce, Shopify, HubSpot, Zendesk, Airtable, Google Sheets,
  Make, Gmail.

**Vapi (40+ integrations):**
- LLMs: OpenAI, Anthropic, Gemini, Groq, custom server endpoint, fine-tuned
  models.
- STT: Deepgram (default), AssemblyAI, Gladia.
- TTS: ElevenLabs (default), PlayHT, Azure, Cartesia, Rime.
- Telephony: Twilio (default), Telnyx, Vonage, plus enterprise SBCs
  (Genesys, Five9, Avaya).
- Business: Salesforce, HubSpot, Slack, Zapier, custom webhooks.

For Blu's: Vapi + Twilio + Deepgram + Claude + ElevenLabs is the full
stack. Voiceflow + Twilio is roughly equivalent if we want a no-code
flow editor for non-engineers (Zach's eventual marketing hire).

## F. Pricing model

**Voiceflow:**
- **Sandbox (Free):** workspace, 1 agent, limited monthly tokens, no
  credit card. Good for prototyping.
- **Pro:** $60/mo — production agents, more tokens, observability.
- **Teams:** $250/mo — collaboration, roles, more channels.
- **Enterprise:** custom — SOC 2, SSO, dedicated support.

**Vapi:**
- **Free trial:** $10 in credits, no time limit. ~30+ minutes of
  testing depending on stack.
- **Per-minute usage:**
  - Vapi orchestration: $0.05/min
  - Deepgram STT: ~$0.01/min
  - LLM (Claude Haiku / GPT-4o-mini): ~$0.02-$0.05/min
  - ElevenLabs TTS: ~$0.04/min
  - Twilio telephony: ~$0.01/min
  - **Total: ~$0.13-$0.30/min** depending on model choice.
- **Concurrent call lines:** $10/line/mo.
- **SMS/chat:** $0.005/message.

For Blu's expected volume (~50 catering calls/mo × 5min avg = 250 min/mo):
**~$32-$75/mo in voice-AI usage** plus a couple of dollars in concurrency
overage. Genuinely cheap for the value. Voiceflow's $60/mo Pro tier is
in the same ballpark but adds the no-code design surface — worth it once
Zach has a non-engineer touching the flow.

## G. Anti-patterns

- **Building a flow chart for everything (Voiceflow trap).** Designers
  reflexively model every conversational branch as a node, ending up with
  100-node spaghetti graphs that LLM-driven flows make obsolete. Lean on
  global instructions + tool calls; reserve nodes for hard guardrails.
- **Per-turn tool calls (Vapi trap).** Calling a tool on every turn balloons
  latency. Cache results in session variables, only call when you need
  fresh data.
- **Free-tier voice cloning experiments leaking into prod.** ElevenLabs
  cloned voices have legal pitfalls; use library voices in production
  unless you have explicit licensing.
- **Hard-coding API keys in the assistant config (Vapi).** Use environment-
  scoped credentials, not literal keys in the system prompt. Easy to leak
  via debug-export.
- **No call recording retention policy.** Both platforms keep recordings
  by default. Set retention windows + redact PII in transcripts before
  long-term storage. For Blu's, the "card number" risk is non-trivial.
- **Skipping the test harness.** Voice bugs are time-consuming to reproduce
  manually. Vapi's automated test suite (or rolling-your-own with synthetic
  Twilio call generation) is non-negotiable for production confidence.
- **Underestimating barge-in complexity.** "User can interrupt the bot"
  sounds simple, takes real engineering. Use platform default; don't
  re-implement.
- **Choosing flow-builder over API for a use case that's 90% LLM freeform.**
  If you're going to write a 4-paragraph system prompt anyway, a visual
  flow tool adds friction. Pick the platform that matches the shape of
  your conversation, not the marketing pitch.

---

**Sources:**
- [Voiceflow Platform](https://www.voiceflow.com/)
- [Voiceflow Pricing](https://www.voiceflow.com/pricing)
- [Vapi.ai Homepage](https://vapi.ai/)
- [Vapi Pricing 2026 Breakdown (CloudTalk)](https://www.cloudtalk.io/blog/vapi-ai-pricing/)
- [Vapi vs Voiceflow Comparison (OpenMic)](https://www.openmic.ai/compare/vapi-ai-voiceflow)
- [Voiceflow vs Vapi (SelectHub)](https://www.selecthub.com/ai-voice-agent-tools/voiceflow-vs-vapi/)
- [Voiceflow Pricing Plans (Lindy)](https://www.lindy.ai/blog/voiceflow-pricing)
- [Vapi Review 2026 (Lindy)](https://www.lindy.ai/blog/vapi-ai)
- [Vapi AI Review (Retell)](https://www.retellai.com/blog/vapi-ai-review)
