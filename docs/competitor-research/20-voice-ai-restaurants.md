# Voice-AI for Restaurants (Kea, ConverseNow, peers)

> Vertical voice-AI vendors targeting QSR and casual dining: AI answers the
> phone, takes the order, drops it into the POS. The space splits cleanly
> into "hybrid AI + human fallback" (Kea), "fully autonomous, brand-tuned"
> (ConverseNow, SoundHound), and "small-restaurant SaaS" (Slang, Loman,
> Bite Buddy). Catering inquiries are a strictly easier problem than QSR
> drive-thru — slower pace, longer turns, no menu-modifier complexity —
> which is why a custom build over Vapi/Voiceflow is more attractive than
> any of these off-the-shelf vendors for Blu's specifically.

## A. Core value prop

**Kea:** AI phone agent for multi-unit pizza/QSR — handles peak-hour
overflow, takes orders, drops them into the POS, with human supervisors
monitoring and stepping in. Claims 99.3% order accuracy and ~$677/mo
recovered revenue per location. **ConverseNow:** Fully autonomous,
brand-fine-tuned voice AI focused on QSR drive-thru and phone, with deep
POS integration and labor-relief framing. Powers Domino's, Wingstop,
Fazoli's. **SoundHound:** Enterprise voice platform — phone, drive-thru,
in-car, kiosk. Powers Chipotle, Jersey Mike's, White Castle. **Slang.ai /
Loman / Bite Buddy:** SMB tier — flat $450-600/mo or per-completed-order
pricing.

## B. Top 5 features worth copying

1. **Menu-validated order extraction.** The AI doesn't just transcribe
   speech — it reconciles each item against the live menu (availability,
   modifiers, prices) before confirming with the caller. *Rationale:* For
   catering, replace "menu" with "package + headcount + date." The AI
   should validate "60 people on June 14" against capacity and lead-time
   rules before saying "we can do that."

2. **Concurrent-call handling with throttling.** Kea handles 5+ simultaneous
   calls per location and degrades gracefully under spikes. *Rationale:*
   Even at our scale, Twilio webhooks must be re-entrant; one slow LLM
   response shouldn't block the next caller. Build the Twilio handler with
   per-call session state in KV from day one.

3. **Hybrid AI + human-in-the-loop.** Kea's "live monitor" lets a human
   take over mid-call when the AI gets stuck. *Rationale:* For after-hours
   catering inquiries, send a Slack/SMS ping to Zach the moment confidence
   drops below threshold or the caller says "speak to a human." Human
   takeover stays on the same call.

4. **Real-time POS write.** Order finalizes → POS receives it within seconds
   → SMS confirmation to the caller. *Rationale:* Replace POS with
   `inquiries:save` + Gmail send to Zach + (eventually) calendar event
   creation. End-to-end: voice call → KV inquiry record + email + calendar
   hold within 30 seconds of hangup.

5. **Custom personas + tone tuning.** ConverseNow lets brands tune accent,
   warmth, brand-voice phrases, and upsell logic per location. *Rationale:*
   Blu's BBQ voice should *feel* like a Texas BBQ joint, not a generic
   call-center bot. Bake the brand voice into the system prompt; capture
   "Texas Southern hospitality" tone through ElevenLabs voice selection.

## C. Notable UI patterns

These vendors all expose a **call-review console** that's worth copying:

- **Call list view:** chronological list of recent calls, each row showing
  outcome (Order placed / Hung up / Escalated / FAQ answered), duration,
  intent, and a play button for the recording.
- **Side-by-side transcript + audio scrubber.** Click a transcript line and
  audio jumps to that point. Highlight detected intent / extracted entities
  inline.
- **Confidence bars per turn** — visual indicator where the AI was sure vs
  guessing. Helps tune the prompt.
- **"Why this happened" panel.** When the AI took an action, show: the
  extracted slots, the matched intent, the LLM reasoning trace.
- **Live monitor mode** showing in-progress calls with a takeover button.
  Critical for the human-in-the-loop story.
- **Heatmap of failure points** — at what conversation turn do calls
  typically derail. Drives prompt iteration.

## D. Data model insights

The shared model across vendors looks like:

- **Call**: `{ id, phone_from, phone_to, started_at, ended_at, duration,
  outcome, recording_url, transcript[] }`
- **Turn**: `{ call_id, role: 'agent' | 'caller', text, audio_offset_ms,
  intent?, slots?, confidence }`
- **Intent**: `{ name, training_phrases[], required_slots[],
  confirmation_template }` — e.g., `place_order`, `check_hours`,
  `request_human`, `cancel_order`.
- **Slot / Entity**: `{ name, type, value, source_turn_id }` — extracted
  from the conversation. e.g., `headcount: 60`, `event_date: 2026-06-14`,
  `package: 'BBQ Classic'`.
- **Escalation rule**: `{ trigger, action }` — e.g., trigger
  `caller_says('human')` → action `transfer_to_phone(+1...)`.
- **Voice prompt**: the system prompt for the LLM, plus the per-intent
  acknowledge/clarify/confirm phrases.

For Blu's, this maps cleanly to existing structures: `Call` becomes a new
KV record `voice:calls:{id}`; `Inquiry` already exists and is the natural
sink for extracted slots. The `intents` set is small and known: catering
inquiry, status check on existing booking, FAQ, human request.

## E. Integration ecosystem

- **Telephony:** Twilio is the universal substrate (also Telnyx, Vonage,
  SignalWire). Kea and ConverseNow abstract this away; for our build, we
  use Twilio directly via `<Stream>` or `ConversationRelay`.
- **POS:** Toast, Square, Clover, Olo (catering-relevant), Brink, NCR Aloha,
  PAR, Focus, Fiserv. Most vendors integrate with 6-10 systems. Olo is
  the catering integration of note.
- **STT:** Deepgram dominates (~150ms latency, restaurant-tuned models),
  Google Speech, AssemblyAI, Gladia.
- **TTS:** ElevenLabs leads on voice quality (~75ms latency); PlayHT, Azure
  Neural, AWS Polly are alternatives.
- **LLM:** OpenAI GPT-4 family, Anthropic Claude, Google Gemini, fine-tuned
  open models. Vendors increasingly let brands BYO.
- **Outbound:** SMS confirmation via Twilio, email via SendGrid/Postmark,
  calendar via Google Calendar API.
- **CRM:** Salesforce, HubSpot pipelines on the enterprise side.

**Reference architecture for a Blu's build:**

```
Twilio inbound call
     ↓ Media Stream / ConversationRelay
Vapi (or our own orchestrator on Vercel + KV)
     ├─ Deepgram STT (streaming)
     ├─ Anthropic Claude (Haiku for low latency, Sonnet for tougher turns)
     │     └─ Tool calls: check_calendar, get_menu, save_inquiry,
     │                    send_quote_email
     └─ ElevenLabs TTS (streaming)
     ↓
Hangup → finalize inquiries:{threadId} record + Gmail draft + calendar hold
```

Achievable target: ~700-900ms mouth-to-ear latency. Acceptable for catering
where turn pace is naturally slower than QSR drive-thru.

## F. Pricing model

Three distinct tiers in this market:

- **Enterprise (Kea, ConverseNow, SoundHound):** $50,000+/year contracts,
  4-week+ implementation, brand-fine-tuned models, deep POS integration.
  Not relevant for Blu's today.
- **SMB SaaS (Slang.ai, Loman.ai, Bite Buddy):** $450-$600/mo flat per
  location, or $1.50/completed-order usage-based. Same-day or week-long
  setup. **This is the comparison anchor for Blu's catering SaaS pricing
  later.**
- **DIY platform (Vapi, Voiceflow, Retell):** ~$0.07-$0.30/minute all-in
  (Vapi base $0.05/min + STT + LLM + TTS + telephony). Pure usage. Low
  fixed cost. **This is what Blu's should build on.**

For a solo BBQ shop fielding ~50 catering calls/month at avg 5min: roughly
$50-$75/mo in voice-AI costs at full DIY-platform pricing. Way under
$450/mo, and we own the experience.

## G. Anti-patterns

- **Long, robotic disclaimers up front.** "Hi, this is the Blu's BBQ
  AI assistant, calls may be recorded, please note I am an AI..." kills
  trust before the conversation starts. Open with a warm greeting; disclose
  AI nature only if asked.
- **Forcing menu navigation through the bot ("press 1 for...").** Speech-
  first; let the caller say what they want. IVR-style trees are an
  anti-pattern in the LLM era.
- **Strict turn-taking.** Real callers interrupt and overlap. The agent
  must support barge-in (cut the TTS when the caller starts speaking).
  Vapi and ConverseNow handle this; many DIY builds don't.
- **High latency (>1.2s).** Anything over ~700ms feels off; over 1.2s feels
  broken. Measure and budget every component.
- **Hallucinated availability.** "Yes, we can do June 14!" without checking
  calendar. Tool-calls are non-negotiable; the LLM must never assert facts
  about your business state without a tool round-trip.
- **No escape hatch.** Caller says "I want a human" → agent says "I can
  help you with that!" — instant trust loss. Always honor the request:
  warm-transfer or take a callback.
- **Recording without consent.** State varies; default to a brief
  consent line in jurisdictions that require two-party.
- **Over-confirming every slot.** "You said 60 people. Is that correct?
  And the date June 14, is that correct?" — exhausting. Confirm in
  batches at end of conversation, not every turn.
- **Locked-in proprietary models.** Vendors that hide the LLM choice make
  it impossible to migrate. BYO-model is a feature.

---

**Sources:**
- [Kea AI](https://kea.ai/)
- [Top 9 AI Phone Ordering Systems 2026 (Kea blog)](https://kea.ai/blog/the-top-9-ai-phone-ordering-systems-to-evaluate-in-2026)
- [ConverseNow](https://conversenow.ai/)
- [Best AI Phone Ordering Systems Jan 2026 (Loman)](https://loman.ai/blog/ai-phone-ordering-systems-restaurants)
- [Best AI Food Ordering for Small Restaurants 2026](https://loman.ai/blog/best-ai-food-ordering-systems-small-restaurants)
- [Best AI Phone Systems for Restaurants 2026 (Bite Buddy)](https://bitebuddy.ai/blog/best-ai-phone-system-restaurants-2026)
- [Top 7 AI Phone Systems for Restaurants 2025 (AI Journal)](https://aijourn.com/the-top-7-ai-phone-systems-for-restaurants-2025-edition/)
- [Twilio Core Latency Guide](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents)
- [Voice AI Infrastructure Guide (Introl)](https://introl.com/blog/voice-ai-infrastructure-real-time-speech-agents-asr-tts-guide-2025)
