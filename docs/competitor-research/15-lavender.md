# Lavender.ai

> AI email coach that lives as a sidebar inside Gmail / Outlook / Outreach / Salesloft.
> Doesn't send for you — it scores and rewrites *as you type*. Cult-favorite among
> SDRs because it visibly improves reply rates without taking the wheel.

## A. Core value prop

Real-time email coach: every draft gets a 0–100 score, line-by-line improvement
suggestions, personalization hints scraped from the recipient's LinkedIn / X /
company news, and a mobile-readability preview — all in a sidebar, all without
leaving the compose window. Public stats: users report **+580% reply rate** and
**+136% meetings booked** (vendor numbers, take with salt — but G2 reviews are
unusually consistent on "this works").

## B. Top 5 features worth copying

1. **Live email score (0–100) updating as you type.**
   The single most addictive UI pattern in B2B SaaS. The score updates with every
   keystroke based on length, reading level, personalization, spam-trigger words,
   subject quality, and mobile-friendliness. For us: as Zach drafts a quote
   reply, a sidebar shows a live "reply-likelihood score" computed by Claude on
   the partial draft. Cheap to implement: debounced fetch on textarea-input,
   one Claude call per ~600ms of idle, render the number.

2. **Line-by-line inline coaching ("this line is confusing — try X").**
   Not a single overall summary; specific *spans* are highlighted with rewrite
   suggestions floating beside them. Ours can do the same — Claude returns a
   list of `{span: "...", suggestion: "...", reason: "..."}` and we render each
   beside the source line. This is a far more useful output shape than "here's
   a rewrite of the whole email."

3. **Personalization Assistant — auto-pulled facts from public sources.**
   Lavender pulls LinkedIn profile, company website, recent X posts, podcast
   appearances, job changes — and proposes 2–3 hooks ("ask about her new role
   at Klaviyo," "reference his recent post about Q3 catering trends"). For
   catering: our "repeat-customer" badge already pulls prior orders. Extend it
   to surface 2–3 *talking-point hooks* on every inquiry detail page ("they
   ordered 80 briskets in 2025; their last event was a wedding rehearsal";
   "their email mentions kosher — flag for menu adjustment").

4. **Cold-email benchmarking ("you're in the 78th percentile for opens").**
   Lavender benchmarks every send against ~50,000 active inboxes / billions of
   emails. We can't match that corpus, but we can build *Zach's own* benchmark
   — "your reply rate on quotes-with-PDF is 64%, on quotes-without-PDF is 41%."
   That's already valuable. The pattern: every score has a *historical
   distribution* alongside it.

5. **Mobile-preview pane.** Sidebar shows what the email looks like on iPhone
   *while you write it*. Catches the most common SDR mistake — long paragraphs
   that look fine on desktop and unreadable on mobile. Trivial: render a
   375px-wide iframe of the draft body next to the textarea. We already check
   mobile at 375px in our smoke tests; same dimension here.

## C. Notable UI patterns

- **Right-side sliding sidebar over Gmail.** Doesn't replace the compose window;
  augments it. Score at top, then collapsible sections for "Personalization,"
  "Tone," "Reading Level," "Subject Line." Each section has a colored ring
  (red/yellow/green) so the rep can see at a glance what needs work. **For
  catering:** when Zach drafts a reply in our app, slide-out a right panel
  with the same structure. We're not in Gmail, we're in our own UI — even
  easier to control.

- **Real-time line-level squiggles.** Like a spell-checker, but for tone /
  clarity / overuse of "I/me/my" vs "you/your." Hover the squiggle to see the
  rewrite suggestion. **Implementation note:** debounce, don't re-run on every
  keystroke; 500–800ms idle is the sweet spot.

- **"Rewrite for me" button per section.** Not a global "rewrite the email"
  button (which produces over-confident slop). Per-paragraph rewrite gives the
  human control over which suggestions to accept.

- **Tone selector pill bar.** "Friendly / Professional / Direct / Empathetic"
  pills above the draft. Click a pill, the suggestions reorient toward that
  tone. For catering this is high-value — wedding inquiries vs corporate
  catering vs church groups need different voices.

- **OCEAN/DISC personality readout (controversial).** Lavender estimates
  recipient personality from public writing samples and adapts suggestions
  accordingly ("she shows high openness — lead with novelty"). This shades into
  creepy (see anti-patterns), but the *idea* — adapting tone to the
  customer's prior language — is sound. Safer version: cluster customers into
  a small handful of styles based on *their actual emails to us* (formal /
  casual / urgent / detail-oriented), and let Claude adapt.

## D. Data model insights

| Concept | Shape |
|---------|-------|
| Draft | id, threadId, subject, body, lastEditedAt, score, scoreBreakdown{personalization,tone,readingLevel,subject,mobile,spam} |
| Suggestion | draftId, span{start,end}, type ("clarity","tone","cta","spam-word"), suggestion, reason, accepted? |
| Profile | recipientEmail, sources[{type:"linkedin"\|"x"\|"company-site"\|"podcast", url, fetchedAt, payload}], hooks[] |
| Hook | profileId, text, sourceUrl, freshness ("days-old"), category ("role-change"\|"news"\|"post"\|"prior-order") |
| Benchmark | userId, metric ("reply-rate","open-rate"), bucket ("with-pdf"\|"weekday"\|"first-touch"), value, percentile |
| ToneProfile | recipientEmail, summary, style ("formal","casual","direct","detailed"), confidence |

For Blu's BBQ specifically: `Profile.hooks[]` is the new primitive. On every
inbound, write Claude-extracted hooks to `inquiries:{threadId}.hooks[]` and
surface them on the inquiry detail page. Cost: one Claude extraction call per
inbound; we already do extraction for fields like `eventDate` — adding `hooks[]`
to the same prompt is free.

## E. Integration ecosystem

- **Native:** Gmail (Chrome extension), Outlook 365.
- **SEPs:** Outreach, Salesloft, HubSpot Sales, Groove, Apollo — Lavender
  appears as an inline panel inside the compose window.
- **CRM:** HubSpot natively; Salesforce via SEP.
- **Data sources (read-only):** LinkedIn, X (Twitter), company websites, public
  podcast indices, LinkedIn feed, public job postings.
- **Privacy posture:** SOC 2, GDPR-certified, "100% encrypted." Lavender
  emphasizes that it doesn't store email content beyond the session.

For us: the relevant integration is **Gmail** (have) + **public LinkedIn
profile fetch** (medium build, gray-area scraping; safer to use a vendor like
ScrapingBee or just skip and use what the customer included in their inquiry).

## F. Pricing model

Honest, public, SMB-friendly — *the model we should emulate*.

- **Free (Basic):** 5 email reviews / month. Enough to try the product.
- **Starter:** **$29/month** — scoring + AI coaching + basic analytics.
- **Pro:** **$49/month** — advanced personalization, detailed analytics,
  priority support.
- **Teams:** **$69/month/user** — team analytics, shared templates, collab.
- **Enterprise:** custom, ~$89+/user/month.
- **Free for students, job seekers, and bootstrapped entrepreneurs** (apply
  via form).

Translation for our pivot: this pricing grid is the right shape. **$29 / $49
/ $69-per-seat / Enterprise** is exactly the SaaS catering tool we should
ship. Lavender is the closest pricing comp to where we want to land.

## G. Anti-patterns

1. **Score addiction / score gaming.** Reps end up writing for the score, not
   for the human. Some users have reported gaming the algorithm to hit 95+
   even when the email is worse. **Lesson:** the score is a *vibe meter*,
   never a gate. Don't block sending below a threshold; just suggest.

2. **Personality scoring shades into creepy.** OCEAN/DISC inferred from public
   writing has the same problem as Gong's surveillance vibe — recipients (and
   reps) feel pre-judged by an algorithm. **Lesson:** we will not infer
   personality from public posts. We *will* adapt to the customer's prior
   tone *with us* (their own emails to Blu's). That's the line.

3. **Over-personalization that sounds stalker-y.** "I saw you posted about
   your kid's soccer game last weekend" — recipients flag this as creepy.
   **Lesson:** stick to *transactional* hooks ("you ordered 80 briskets last
   year"; "your event is in 12 days"). Don't reach into the customer's
   personal life.

4. **Reading-level fixation.** Lavender pushes "Grade 5 reading level" hard.
   For B2B sales it works; for catering it can flatten warmth. **Lesson:**
   reading-level is one signal of many; weight it appropriately for hospitality
   tone.

5. **Chrome-extension-only fragility.** Lavender breaks when Gmail's UI
   changes; review forums get noisy after every Gmail update. **Lesson:**
   our equivalent should live *inside our app*, not as a Gmail extension.
   We control the surface, no fragility.

6. **Public stats inflation.** "+580% reply rate" is a vendor number, not a
   peer-reviewed study. Honest reviews on G2 cite real but smaller lifts
   (15–40%). **Lesson:** don't over-claim our own numbers. Show
   percentile-based benchmarks against the user's own historical data, which
   is honest and harder to game.

---

**Sources**
- [Lavender homepage](https://www.lavender.ai/)
- [Lavender — Things you didn't know it can do](https://www.lavender.ai/blog/things-lavender-can-do-that-you-probably-didnt-know)
- [What's New in Lavender 3.0](https://www.lavender.ai/blog/9189971-what-s-new-in-lavender-3-0)
- [Lavender Chrome Web Store](https://chromewebstore.google.com/detail/lavender/necbalcggglceeioaehdbkpbldmoabii?hl=en)
- [Lavender G2 reviews](https://www.g2.com/products/lavender/reviews)
- [Lavender Pricing 2026 — MarketBetter](https://marketbetter.ai/blog/lavender-ai-pricing-breakdown-2026/)
- [Lavender review — Reply.io](https://reply.io/blog/lavender-ai-review/)
- [Lavender review 2026 — MarketBetter](https://marketbetter.ai/blog/lavender-ai-review-2026/)
- [Lavender Pricing — G2](https://www.g2.com/products/lavender/pricing)
- [Lavender review — Originality.AI](https://originality.ai/blog/lavender-ai-review)
- [12 Lavender alternatives — Improvado](https://improvado.io/blog/lavender-ai-alternatives)
