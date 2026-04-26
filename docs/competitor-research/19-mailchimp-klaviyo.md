# Mailchimp & Klaviyo (Email marketing automation)

> Mailchimp is the OG SMB email tool; Klaviyo overtook it for ecommerce
> by going deeper on real-time behavioral segmentation and revenue
> attribution. Reviewer ratings reflect the gap: Klaviyo 4.7/5 across 23k+
> reviews, Mailchimp 4.4/5 across 38k+. Mailchimp's free tier collapsed
> in 2025 (250 contacts, 500 sends, no automations) — for a bootstrapped
> founder, Klaviyo's free tier (250 contacts, 500 monthly emails, full
> automation) is now the better starting point.

## A. Core value prop

**Mailchimp:** All-in-one marketing platform — email + automations + landing
pages + light CRM — aimed at small businesses who want to start fast with
templates and a friendly editor.

**Klaviyo:** A real-time customer-data platform with email and SMS bolted
on. Every customer event flows in via API, segments rebuild instantly, and
flows trigger off behavior that actually predicts revenue.

## B. Top 5 features worth copying

1. **Real-time, behavior-based segmentation (Klaviyo).** A segment isn't a
   saved query — it's a live materialized view that updates on every event.
   "Viewed catering page 2x in 7 days AND has not booked" recalculates
   continuously. *Rationale:* Blu's already logs activity per inquiry.
   A small "rebuild on event" predicate engine over `inquiries:index` would
   give us this for ~50 lines of code. Far more useful than Mailchimp-style
   tag-and-filter snapshots.

2. **Visual flow builder with branching (both, but Klaviyo's is deeper).**
   Drag-drop nodes: trigger → wait → send → branch on open/click → wait →
   send. Each node has a status counter ("147 currently in this step").
   *Rationale:* We already have QStash + scheduled tasks. A flow-builder
   UI on top of the existing scheduler would let Zach build "lead → 1 day
   nudge → 3 day nudge → mark cold" without code.

3. **Pre-built flow templates (Klaviyo).** "Welcome series," "Abandoned
   cart," "Post-purchase," "Win-back" — each ships as a complete graph with
   recommended copy, timing, and split tests. *Rationale:* Catering has its
   own canonical flows (inquiry → quote → deposit reminder → 1-week-out
   confirmation → post-event review request). Bake those in as defaults.

4. **A/B testing on subject lines and send time, with statistical
   significance gating.** Klaviyo only declares a winner when n is large
   enough; otherwise it labels "inconclusive." *Rationale:* Tiny detail
   that prevents the classic "we won! it was 3 vs 2 conversions"
   self-deception.

5. **Predictive analytics: CLV, churn risk, expected next-purchase date.**
   Klaviyo computes these per profile and exposes them as filterable fields.
   *Rationale:* For repeat catering customers, "expected next-event date"
   is gold — we can pre-warm an inquiry 30 days before. Implement with a
   simple median-interval-since-last-event heuristic before touching ML.

## C. Notable UI patterns

- **Flow builder canvas with auto-layout.** Nodes snap to a grid; the canvas
  re-flows when you insert a step so connections never cross. Klaviyo and
  Mailchimp both do this — Klaviyo's is smoother.
- **"Currently in step" counter on every node.** A ring badge shows the
  live count of profiles sitting at that step. Tells you instantly where
  flows are stuck.
- **Live segment preview.** When building a segment, the right pane shows
  matching profiles updating as you drag conditions. No "Save and refresh."
- **Drag-drop email composer with content blocks.** Image, text, button,
  divider, product (Klaviyo only), spacer. Each block has its own settings
  popover.
- **"Send time optimization" toggle** that schedules each recipient
  individually based on their historic open behavior. Tiny UI commitment,
  measurable open-rate lift.
- **Heatmap overlay on sent emails** showing where recipients clicked.
  Helps identify dead CTAs.
- **Test inbox preview** rendering across Gmail / Outlook / Apple Mail in
  one view.

## D. Data model insights

Klaviyo's data model is the more transferable one for our purposes:

- **Profile**: persistent customer object with `email`, `phone`, `properties`
  (custom KV), `predictive_metrics` (CLV, churn_risk, next_purchase_date).
- **Event**: `{ profile_id, event_name, timestamp, properties }`. Events
  drive everything — segments, flows, analytics. Common event names:
  `Placed Order`, `Viewed Product`, `Started Checkout`, `Email Opened`.
  At Blu's, equivalents would be `Inquiry Received`, `Quote Sent`,
  `Deposit Paid`, `Event Confirmed`, `Event Completed`.
- **Segment**: `{ name, conditions[], match: 'all' | 'any' }` — evaluated
  on every event ingest. Static lists also exist but are discouraged.
- **Flow**: `{ trigger_event_or_segment, nodes[], edges[] }`. Nodes are
  `send_email`, `wait`, `conditional_split`, `update_profile`, `webhook`.
- **Campaign**: a one-time blast to a segment, distinct from a flow.

Mailchimp's model is similar but historically tag-centric: `Audience`
(list) → `Contact` (with tags + groups) → `Journey` (the flow). The 2024
"Customer Journey Builder" caught up to Klaviyo's flow UX, but the
underlying data is still list-and-tag rather than event-stream.

For Blu's: we already emit events implicitly (the inquiries activity log).
Codifying them into a small `events:{profile_id}` stream key in KV would
unlock segment-style queries without a new database.

## E. Integration ecosystem

**Klaviyo:** 350+ pre-built integrations.
- Ecommerce: Shopify (deepest), WooCommerce, BigCommerce, Magento, Wix.
- Subscription: Recharge, Smartrr.
- Reviews: Yotpo, Stamped, Okendo.
- Loyalty: Smile.io, LoyaltyLion.
- Ads: Meta, Google Ads (audience sync).
- API: REST + webhooks; events-first SDK.

**Mailchimp:** ~300 integrations via its app marketplace + Zapier.
- Shopify (re-integrated post-Intuit acquisition), Square, Stripe.
- Canva, WordPress, Squarespace.
- Slack, Salesforce, HubSpot.
- Heavy Zapier dependence for long-tail tools.

**Both** offer Twilio-friendly SMS add-ons; Klaviyo SMS is native and
deeply integrated with flows, Mailchimp SMS is a newer bolt-on.

## F. Pricing model

Per-contact, with email-volume tiers:

**Mailchimp** (in 2026, post-Intuit reductions):
- **Free:** 250 contacts, 500 sends/mo, no automations, Mailchimp branding.
- **Essentials:** ~$13/mo (500 contacts) — basic automations.
- **Standard:** $20/mo+ — full Customer Journey Builder.
- **Premium:** $350/mo+ — phone support, advanced segmentation.

**Klaviyo:**
- **Free:** 250 profiles, 500 email sends/mo, full feature access including
  automations and segmentation.
- **Email:** $20/mo (500 contacts), scaling with contact count.
- **Email + SMS:** combined pricing; SMS billed per message.

**Verdict for Zach today:** Klaviyo's free tier dominates Mailchimp's
because automations are included. Use Klaviyo free for the next ~250
contacts; revisit at scale.

## G. Anti-patterns

- **Tag-spaghetti (Mailchimp).** Reviewers consistently complain that
  Mailchimp's tags + groups + segments + audiences create overlapping ways
  to model the same thing, and customers end up with hundreds of tags they
  don't remember adding. Don't ship multiple grouping primitives — pick one
  (we have `inquiries.status` + activity-log; resist adding `tags[]`).
- **Pricing-cliff anti-pattern.** Klaviyo and Mailchimp both jump in price
  at every contact tier; users get bill-shocked. If we ever charge our own
  customers, prefer smooth per-event metering over stepped tiers.
- **"Forever automations" with no exit conditions.** Both platforms warn
  about this — flows where customers loop forever because no goal step
  ends them. Always add an exit predicate (e.g., "stop flow when
  status = booked").
- **Mailchimp's recent free-tier degradation** (250 contacts, 500 sends, no
  automations as of 2025) is a textbook trust-burning move. Reviews and
  alternative-tool roundups now lead with "Mailchimp killed its free tier."
  Lesson: never quietly remove a free-tier feature your users depend on —
  grandfather them.
- **Over-eager AI subject-line rewrites.** Klaviyo's AI sometimes "fixes"
  intentionally lowercase or punctuation-light subject lines. Always make
  AI suggestions opt-in per send.
- **Flow templates that ship without good copy.** Templates with placeholder
  copy ("Hi {first_name}, here's our welcome!") get sent unedited. Either
  ship with great default copy or refuse to send until customized.

---

**Sources:**
- [Klaviyo Features](https://www.klaviyo.com/features)
- [Mailchimp Features](https://mailchimp.com/features/)
- [Klaviyo vs Mailchimp 2026 (Klaviyo)](https://www.klaviyo.com/compare/klaviyo-vs-mailchimp)
- [Klaviyo vs Mailchimp Comparison (Moosend)](https://moosend.com/blog/klaviyo-vs-mailchimp/)
- [Mailchimp Free Plan Changes 2026](https://blog.groupmail.io/mailchimp-free-plan-changes-2026/)
- [Klaviyo vs Mailchimp Stats 2026](https://www.amraandelma.com/klaviyo-vs-mailchimp-stats/)
- [Mailchimp AI vs Klaviyo AI vs Braze AI](https://genesysgrowth.com/blog/mailchimp-ai-vs-klaviyo-ai-vs-braze-ai)
