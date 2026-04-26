# ClickUp (Marketing modules)

> Deep dive on ClickUp's marketing-team UX: content calendars, social scheduling,
> campaign management, and dashboards. ClickUp positions itself as
> "the operating system for marketing teams" — campaigns, briefs, content
> production, creative proofing, and reporting in one workspace.

## A. Core value prop

A single AI-powered workspace where marketing teams plan, execute, proof, and
report on multi-channel campaigns — replacing the standard sprawl of Asana
plus Airtable plus a content calendar plus a separate dashboard tool.

## B. Top 5 features worth copying

1. **Unified campaign object with cascading children.** A "Campaign" parent
   task owns child tasks for briefs, drafts, posts, ads, and emails. Status
   on the parent rolls up automatically. *Rationale:* Blu's already has
   `inquiries:{threadId}` as a parent record — we could build a similar
   "Marketing Campaign" object in KV with child posts/emails/SMS each carrying
   their own status, due date, and channel.

2. **Multi-view content calendar (Calendar / Board / List / Gantt) on the same
   data.** One source of truth, four lenses. *Rationale:* Our calendar.js
   already does Day/Week/Month — we could extend to a Board view (kanban by
   status) and a List view for the marketing content table. Same underlying
   `events` array, four render functions.

3. **Creative proofing with inline annotations on assets.** Reviewers click
   on the image/PDF and leave a comment pinned to coordinates. *Rationale:*
   Quote PDFs and email drafts both go through approval — pinned-comment
   annotation on the rendered PDF would beat the current "thumbs-up the whole
   draft" flow in chat-approval.js.

4. **Automations triggered by status changes.** "When status moves to Ready
   for Review, assign @reviewer and post to #marketing." Visual rule builder.
   *Rationale:* QStash already gives us delayed-task plumbing. A small
   "when X happens, do Y" rule engine on top of the inquiries activity log
   would unlock most of the workflow value without bringing in a real PM tool.

5. **Goal tracking that links campaigns to revenue / OKRs.** Each campaign
   declares a target (leads, revenue, RSVPs); the dashboard shows progress
   against goal in real time. *Rationale:* Blu's lacks any "did this email
   sequence actually close deals?" closed-loop view. Even a crude
   `campaign_id` foreign key on inquiries would let us answer it.

## C. Notable UI patterns

- **Hover-to-quickadd on the calendar grid.** Hovering any day cell shows a
  "+" affordance that opens a lightweight create modal pinned to that date —
  no full page navigation. We have empty cells today; a hover-add would be
  one CSS rule and one event listener away.
- **Color-coded "lanes" by channel** (email = blue, social = pink, ads =
  orange) on the calendar. Persistent color identity across views.
- **Drag a card from List view → it lands on a date in Calendar view in the
  same workspace,** because both views share state. We could mimic with the
  HTML5 drag-and-drop API on the inquiries cards.
- **Live dashboard widgets** that animate on data change — counter widgets
  tween from 12 → 13 instead of snapping. Very small UX touch, large
  perceived-quality lift.
- **"What's blocked" widget** as a permanent dashboard tile, not a separate
  page. Surfaces stuck items without requiring the user to navigate.
- **Inline @mentions inside task descriptions** that resolve to assignees
  with hover cards.
- **Custom fields per List** (e.g., a Content list has fields for
  Channel, Persona, CTA, Word Count) — our inquiries records already have
  arbitrary keys; exposing a "field schema per status" UI would let Zach add
  fields without code.

## D. Data model insights

ClickUp's marketing-flavored entities (paraphrased from their data model):

- **Workspace → Space → Folder → List → Task → Subtask.** The marketing
  Space typically holds Folders for "Campaigns," "Content," "Social," each
  with its own Lists.
- **Task** carries: `id`, `name`, `description`, `status`, `assignees[]`,
  `due_date`, `start_date`, `priority`, `tags[]`, `parent`, `custom_fields{}`.
- **Custom field types:** text, number, date, dropdown, label (multi-select),
  money, formula, rollup. Marketing teams heavily use `dropdown` for
  Channel / Persona and `label` for tags.
- **Goals** are first-class entities with linked target metric and a list of
  Tasks contributing to them — progress is computed.
- **Dashboards** subscribe to filtered task queries; each widget is
  `{ widget_type, data_source_query, render_options }`.
- **Automations**: `{ trigger, conditions[], actions[] }` — same shape as a
  classic if-this-then-that rule engine.

For Blu's BBQ, the salvageable pattern: keep a flat KV store, but introduce
a `campaign` field on inquiries plus a top-level `campaigns:{id}` record with
goal + child IDs. That gives us campaign-level rollups without an ORM.

## E. Integration ecosystem

- **200+ integrations**, most relevant for marketing: HubSpot (CRM/email),
  Mailchimp, Salesforce, Google Drive, Dropbox, Figma (design files), Slack,
  Zoom, Loom (video review), Google Calendar, Outlook, Zapier/Make for the
  long tail.
- **Native Gmail integration** that lets you create tasks from emails and
  reply from within ClickUp — directly relevant to Blu's existing Gmail
  intake.
- **Public REST API + webhooks** with rate-limited endpoints; webhooks fire
  on task status changes, comments, and custom-field updates.
- **Embed view:** a ClickUp view can be iframed into other tools, and other
  tools can be iframed into ClickUp.

## F. Pricing model

Per-seat, with a generous free tier:

- **Free Forever:** unlimited members, unlimited tasks, 100 MB storage, basic
  dashboards. Good enough for a solo founder.
- **Unlimited:** $7/user/month — unlimited dashboards, integrations, custom
  fields.
- **Business:** $12/user/month — advanced automations, time tracking, goal
  folders.
- **Business Plus:** $19/user/month.
- **Enterprise:** custom.
- AI add-on: $7/user/month on top of any tier (ClickUp Brain).

For Zach today: the free tier covers him; the moment he has 2-3 people
the cost is still trivial. Useful comparison anchor for future SaaS pricing.

## G. Anti-patterns

- **Feature sprawl is paralyzing.** ClickUp's biggest review complaint is
  "too many features, too many settings." Reviewers consistently say the
  first month is overwhelming. Don't ship a dashboard with 40 widget types.
- **Slow render on large workspaces.** Reports of 5-10s page loads with
  10k+ tasks. We're nowhere near this scale, but the lesson is: paginate
  early, lazy-load views, don't render everything at once.
- **Dashboard widgets that pull from too many queries** — ClickUp dashboards
  with 20+ widgets stutter. Cap our dashboard at ~8 widgets, batch queries.
- **Over-customization without sensible defaults.** Users have to design
  their own status workflows, fields, and views before getting value. We
  should ship with opinionated defaults (Lead → Quoted → Booked → Done) and
  only let power users customize.
- **The "Spaces / Folders / Lists / Tasks / Subtasks" hierarchy is too deep**
  for small teams. Reviewers say they get lost. A two-level hierarchy
  (Campaign → Item) is plenty for our scale.
- **Notifications firehose** by default — every comment, every status change.
  Smart-default to digest mode, not real-time-everything.

---

**Sources:**
- [ClickUp Marketing Page](https://clickup.com/teams/marketing)
- [ClickUp Content Calendar feature](https://clickup.com/features/content-calendar)
- [ClickUp Marketing Dashboards blog](https://clickup.com/blog/marketing-dashboards/)
- [ClickUp Capterra reviews](https://www.capterra.com/p/158833/ClickUp/reviews/)
- [TheCMO 2026 ClickUp review](https://thecmo.com/tools/clickup-review/)
