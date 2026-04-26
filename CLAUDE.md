# Blu's BBQ — Codebase Quick Reference

Quick-start guide for every Claude Code session in this repo. Read this before grepping.

---

## Stack Overview

- **UI:** single-file `index.html` (~91 KB) — all pages, styles, and inline JS in one file
- **API:** serverless Node.js handlers in `api/*.js` deployed on Vercel
- **Storage:** Upstash KV (Redis REST) — tokens, inquiries, subscriptions, history
- **Queue:** QStash — delayed email via `/api/schedule` → `/api/dispatch/email`
- **Split modules:** `static/js/` and `static/css/` — loaded by index.html; editable via self-modify

---

## Load-Bearing Invariants — DO NOT REGRESS

### Gmail sender lockdown

- Sending is locked to `info@blusbarbeque.com`.
- OAuth uses `login_hint`, `prompt=consent select_account`, `access_type=offline`.
- Token storage validates `id_token.email` on every callback.
- `api/dispatch/email.js` calls `users.getProfile` before every send to confirm sender.
- **DO NOT TOUCH:** `api/dispatch/email.js`, `api/auth/*`.

### VAPID no-store header

- `api/notifications/vapid-key.js` sets `Cache-Control: no-store`.
- Client fetch in `static/js/notifications.js` uses `{ cache: 'no-store' }`.
- **Reason:** Caching this endpoint caused `VapidPkHashMismatch` on iPhones (incident 2026-04-20).
- Do not introduce any caching on this endpoint or its client fetch.

### Self-modify scope

- `api/self-modify.js` reads/writes `index.html` plus every file in `STATIC_MODULE_FILES`.
- `STATIC_MODULE_FILES` currently covers `static/js/` (menu, calendar, deposits, repeat-customer,
  pipeline-alerts, quote-revise, chat-approval, notifications, **inquiries-filters**), all of
  `static/css/`, and selected `api/` files.
- **If you add a new split module,** add it to `STATIC_MODULE_FILES` in `api/self-modify.js`.

---

## `index.html` Region Map

Line numbers as of HEAD (use `grep -n "id=\"page-"` to refresh after edits):

| Region                 | Element / ID      | Lines                    |
| ---------------------- | ----------------- | ------------------------ |
| Header / sidebar nav   | `aside.sidebar`   | 574–628                  |
| Pipeline page          | `#page-pipeline`  | 639–712                  |
| Quote Builder          | `#page-quotes`    | 715–897                  |
| AI Chat                | `#page-ai`        | 900–997                  |
| Scheduled tasks        | `#page-scheduled` | 998–1009                 |
| Inquiries              | `#page-inquiries` | 1011–1150                |
| Calendar               | `#page-calendar`  | 1153–1256                |
| Mod History            | `#page-history`   | 1271–end of page section |
| Inquiries filter chips | `#inq-chips`      | ~1029                    |
| Date-range chips       | `#inq-date-chips` | ~1030                    |

Key functions (inline JS starting ~line 1484):

| Function                       | ~Line | Notes                                                 |
| ------------------------------ | ----- | ----------------------------------------------------- |
| `showPage(page)`               | 1506  | page router                                           |
| `getFilteredInquiries(filter)` | 3106  | status-chip predicate                                 |
| `renderInqCards()`             | 3077  | calls `inqEventDateInRange` from inquiries-filters.js |
| `applyInqCustomRange()`        | 3193  | sets `inqCustomStart`/`inqCustomEnd` globals          |

---

## Key Modules

| File                             | Purpose                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static/js/inquiries-filters.js` | `inqEventDateInRange(filter, inq, nowDate?, customStart?, customEnd?)` and `isNeedsReview(inq)` — date/status filter predicates, extracted for testability |
| `static/js/quote-engine.js`      | `calcQuoteTotals(foodSubtotal, servicePct, deliveryFee, taxExempt)` — pricing math; `SALES_TAX_RATE=0.0825`, `QB_DELIVERY_FEE=50`                          |
| `static/js/calendar.js`          | Day/Week/Month views, event state, `calInit()` / `calPrev()` / `calNext()`                                                                                 |
| `static/css/calendar.css`        | Calendar layout and color styles                                                                                                                           |
| `static/js/notifications.js`     | VAPID public-key fetch, `pushManager.subscribe`, `notifInit()`                                                                                             |
| `static/js/chat-approval.js`     | Chat draft approval queue UI                                                                                                                               |
| `static/js/deposits.js`          | Deposit tracking panel                                                                                                                                     |
| `static/js/pipeline-alerts.js`   | Rule-based alert rendering                                                                                                                                 |
| `static/js/repeat-customer.js`   | Repeat-customer badge fetch                                                                                                                                |
| `static/js/quote-revise.js`      | Quote revision flow                                                                                                                                        |
| `static/js/menu.js`              | Client-side menu loading (mirrors `api/_lib/menu.js`)                                                                                                      |

---

## API Endpoints

| File                                | Method          | Route                             | What it does                                                           |
| ----------------------------------- | --------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `api/self-modify.js`                | GET/POST        | `/api/self-modify`                | Read/write index.html + STATIC_MODULE_FILES via AI dashboard (Rule 14) |
| `api/modify-history.js`             | GET/POST        | `/api/modify-history`             | Audit log of AI modifications                                          |
| `api/modify-phases.js`              | GET/POST        | `/api/modify-phases`              | Phase-duration medians for ETA display                                 |
| `api/schedule.js`                   | POST            | `/api/schedule`                   | Store task in KV; enqueue QStash callback                              |
| `api/tasks.js`                      | GET/DELETE      | `/api/tasks`                      | List/cancel scheduled tasks                                            |
| `api/dispatch/email.js`             | POST            | `/api/dispatch/email`             | QStash callback — verifies HMAC, sends via Gmail API                   |
| `api/chat.js`                       | POST            | `/api/chat`                       | Non-streaming Claude Haiku endpoint                                    |
| `api/chat-stream.js`                | POST            | `/api/chat-stream`                | Streaming Claude Haiku (output-128k beta)                              |
| `api/chat/history.js`               | GET/POST        | `/api/chat/history`               | Persist chat messages in KV (max 100)                                  |
| `api/chat/approval.js`              | GET/POST/DELETE | `/api/chat/approval`              | Draft-approval queue (max 20)                                          |
| `api/auth/init.js`                  | GET             | `/api/auth/init`                  | Start OAuth flow (gmail + calendar + openid)                           |
| `api/auth/callback.js`              | GET             | `/api/auth/callback`              | Exchange code, validate email, store tokens                            |
| `api/auth/gmail.js`                 | GET             | `/api/auth/gmail`                 | Returns OAuth URL (gmail.send scope)                                   |
| `api/auth/status.js`                | GET             | `/api/auth/status`                | Returns `{ connected, email, hasRefreshToken }`                        |
| `api/inquiries/list.js`             | GET             | `/api/inquiries/list`             | Returns inquiries index (max 500, newest-first)                        |
| `api/inquiries/get.js`              | GET             | `/api/inquiries/get`              | Single inquiry with raw_email + quote                                  |
| `api/inquiries/save.js`             | POST            | `/api/inquiries/save`             | Deep-merge or create inquiry; updates index                            |
| `api/inquiries/archive.js`          | POST            | `/api/inquiries/archive`          | Set status=archived, apply Gmail label                                 |
| `api/inquiries/approve.js`          | POST            | `/api/inquiries/approve`          | Set approved=true, trigger AI quote if needed                          |
| `api/inquiries/acknowledge.js`      | POST            | `/api/inquiries/acknowledge`      | Mark activity log entries acknowledged                                 |
| `api/inquiries/draft-email.js`      | POST            | `/api/inquiries/draft-email`      | Claude drafts catering reply                                           |
| `api/inquiries/send-now.js`         | POST            | `/api/inquiries/send-now`         | Direct Gmail send with PDF attach (sender-locked)                      |
| `api/inquiries/process-followup.js` | POST            | `/api/inquiries/process-followup` | Check thread for new messages, re-extract                              |
| `api/inquiries/by-email.js`         | GET             | `/api/inquiries/by-email`         | Lookup by customer email (repeat-customer)                             |
| `api/quotes/ai-generate.js`         | POST            | `/api/quotes/ai-generate`         | Claude generates structured quote from inquiry                         |
| `api/quotes/render-pdf.js`          | POST            | `/api/quotes/render-pdf`          | Generates PDF from quote object                                        |
| `api/gmail/list-inquiries.js`       | GET             | `/api/gmail/list-inquiries`       | Lists inbox messages from info@blusbarbeque.com                        |
| `api/gmail/extract-inquiry.js`      | POST            | `/api/gmail/extract-inquiry`      | Claude extraction of fields from email body                            |
| `api/gmail/send.js`                 | POST            | `/api/gmail/send`                 | Gmail send (cookie-based tokens, legacy)                               |
| `api/diag/verify-sender.js`         | GET             | `/api/diag/verify-sender`         | Reads SENT label to confirm From headers                               |
| `api/calendar/list.js`              | GET             | `/api/calendar/list`              | Fetch events for month range                                           |
| `api/calendar/create.js`            | POST            | `/api/calendar/create`            | Create calendar event (3h default, Chicago TZ)                         |
| `api/calendar/update.js`            | PATCH           | `/api/calendar/update`            | Patch existing event fields                                            |
| `api/calendar/delete.js`            | DELETE          | `/api/calendar/delete`            | Remove event by eventId                                                |
| `api/calendar/watch-register.js`    | POST            | `/api/calendar/watch-register`    | Register Google push-notification watch                                |
| `api/calendar/watch-status.js`      | GET             | `/api/calendar/watch-status`      | Current watch channel state                                            |
| `api/calendar/webhook.js`           | POST            | `/api/calendar/webhook`           | Receive Google Calendar push notifications                             |
| `api/deposits/list.js`              | GET             | `/api/deposits/list`              | All deposits for a threadId                                            |
| `api/deposits/save.js`              | POST            | `/api/deposits/save`              | Record/update/delete deposit entry                                     |
| `api/pipeline/alerts.js`            | GET             | `/api/pipeline/alerts`            | Rule-based pipeline alerts                                             |
| `api/notifications/vapid-key.js`    | GET             | `/api/notifications/vapid-key`    | Return VAPID public key (`Cache-Control: no-store`)                    |
| `api/notifications/subscribe.js`    | GET/POST/DELETE | `/api/notifications/subscribe`    | Manage push subscriptions in KV                                        |
| `api/notifications/send.js`         | POST            | `/api/notifications/send`         | Send Web Push to all subscribers via VAPID                             |
| `api/cron/poll-inquiries.js`        | cron            | every 15 min                      | Poll Gmail, extract fields via Claude, generate quote                  |
| `api/cron/renew-calendar-watch.js`  | cron            | daily 5 AM CT                     | Renew watch channel if expiring within 24h                             |
| `api/cron/mark-completed.js`        | cron            | daily 6 AM                        | Set status=completed for past-date inquiries                           |

Shared libs: `api/_lib/menu.js` (pricing), `api/_lib/pdf-gen.js` (pure-Node PDF), `api/_lib/source.js` (source detection).

---

## KV Keys in Use

| Key                           | Contents                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| `gmail:info@blusbarbeque.com` | OAuth tokens for the locked sender account                  |
| `gmail:tokens`                | Legacy key (deleted on new auth; keep for migration safety) |
| `inquiries:index`             | JSON array of inquiry summaries (max 500)                   |
| `inquiries:{threadId}`        | Full inquiry record                                         |
| `modify-history`              | JSON array of AI modification audit log entries             |
| `modify:phases`               | Phase-duration medians object                               |
| `push:subscriptions`          | JSON array of Web Push subscription objects                 |
| `chat:history`                | JSON array of chat messages (max 100)                       |
| `chat:approval:queue`         | JSON array of draft items awaiting approval (max 20)        |
| `calendar:id`                 | Google Calendar ID for "Blu's Barbeque Catering"            |
| `calendar:syncToken`          | Incremental sync token for calendar list                    |
| `calendar:watch`              | Watch channel metadata (channelId, expiration)              |
| `calendar:pendingRefresh`     | Flag set by webhook; cleared after re-sync                  |
| `deposits:{threadId}`         | JSON array of deposit entries for that thread               |
| `bbq:processed-label-id`      | Gmail label ID for "BBQ-Processed"                          |
| `bbq:archived-label-id`       | Gmail label ID for "BBQ-Archived"                           |

---

## How to Verify Changes (Mandatory Each Session)

### 1. Confirm the deploy has your change

```bash
curl -s https://blus-bbq.vercel.app/ | grep -c "YOUR_STRING"
# or against a preview URL:
curl -s "$PREVIEW_URL" | grep "YOUR_STRING"
```

### 2. Check API data shape

```bash
curl -s "https://blus-bbq.vercel.app/api/inquiries/list" | jq '.inquiries | length'
curl -s "https://blus-bbq.vercel.app/api/notifications/vapid-key" | jq .
```

### 3. UI flows — headless Playwright (one bash call)

```bash
npx playwright test tests/smoke.spec.js --reporter=line
```

### 4. Run unit tests

```bash
npm test
```

### 5. Visual spot-check only

Use Chrome MCP (`mcp__Claude_in_Chrome__*`) for pixel/visual verification only.
**Never** use it to assert filter counts, DOM state, or data correctness — use curl+jq for those.

---

## Branching Discipline

Every branch **must** descend from `main`:

```bash
git checkout main && git pull origin main && git checkout -b <new-branch>
```

**Do NOT branch from another feature branch.** Branching from a feature branch drags its
uncommitted squash commits into your PR diff (this caused the Calendar PR to include Last Week
changes on 2026-04-20).

---

## Preview URL Verification

Every PR gets an automatic Vercel preview. Verify against the preview URL **before** merging.

```bash
# Get preview URL from PR checks:
gh pr view <N> --json statusCheckRollup | jq '.statusCheckRollup[] | select(.name | test("Vercel")) | .targetUrl'
```

Then `curl` the preview URL as in step 1 above. The smoke CI workflow also runs against the
preview automatically on every push.

---

## "Don't Touch" List

These files have subtle invariants. Only edit them when the task **explicitly** calls for it:

- `api/dispatch/email.js` — sender lockdown; any change risks sending from wrong account
- `api/auth/init.js`, `api/auth/callback.js` — OAuth flow; token storage validates sender email
- `api/self-modify.js` — self-modify pipeline internals (except `STATIC_MODULE_FILES` list)
- `api/notifications/vapid-key.js` — must remain `Cache-Control: no-store`

---

## Running Tests

```bash
npm test          # runs all unit tests via node --test
npx playwright test tests/smoke.spec.js   # smoke suite (needs a running/deployed URL)
```

Unit test files live next to their source:

- `static/js/inquiries-filters.test.js`
- `static/js/quote-engine.test.js`
- `api/notifications/send.test.js`

---

## Pre-commit Hooks (husky + lint-staged)

Every commit runs through `.husky/pre-commit`, which:

1. Runs `lint-staged` — ESLint `--fix` and Prettier on the staged files.
2. Runs `node scripts/lint.js` only when `index.html` is staged (JS-syntax check on inline scripts).
3. Runs `npm test` (the full unit-test suite via `node --test`).

A fresh clone gets the hook installed automatically by the `prepare` npm script (which runs `husky` after `npm install`). If the hook is missing, run `npm install` again.

**Working with the hook:**

- If `lint-staged` auto-fixes a file, **stage the auto-fixed version and re-commit** (don't bypass).
- If unit tests fail, fix them first — never commit known-broken tests.
- `--no-verify` is reserved for true emergencies. Document the reason in the commit body if you must use it.

**Editor-time formatting:** `eslint.config.js` (flat config; ESLint v9+) and `.prettierrc.json` at the repo root drive both the hook and any IDE Prettier/ESLint integration. `index.html` is excluded from Prettier (see `.prettierignore`) because reformatting the 91 KB single-file UI would create unreviewable diffs — `scripts/lint.js` continues to syntax-check inline scripts.

**Validating the wiring:** `scripts/hooks.test.js` asserts that `.husky/pre-commit`, `lint-staged` config in `package.json`, and `.prettierignore`'s `index.html` exclusion all stay in place. If you delete or rename any of them, the test fails — that's the safety net.

---

## Destructive Action Explanations

Before requesting user approval for any action that could delete, destroy, overwrite, or irreversibly change state — including but not limited to: `rm`, `sudo`, `git push --force`, `git reset --hard`, `git branch -D`, `git clean -fd`, `git push --delete`, `drop table`, `truncate`, `delete from`, `uninstall`, `shutdown`, `reboot`, `crontab -r`, `docker volume rm`, `docker system prune`, `brew uninstall`, `pip uninstall`, `npm uninstall --global`, `npm publish`, `gh repo delete`, `gh release delete`, `find ... -delete`, `find ... -exec rm` — first output a plain-English explanation block in the chat covering:

1. **What** the exact command will do (e.g. "Delete the directory `node_modules/` and all contents").
2. **Why** you need to run it (e.g. "Forcing a clean install to resolve a dependency conflict").
3. **Scope** — what files, data, or state will be affected (e.g. "Affects only `node_modules/`; no source code, config, or git history changes").
4. **Rollback** — how to undo it, or a note that it cannot be undone (e.g. "Reversible via `npm install`" or "Irreversible — data will be permanently lost").
5. **Blast radius** — local only, repo-wide, or affects shared services (production, shared KV, deployed env vars, etc.).

Output this block as regular text in the chat before the action is executed. The user's permission prompt will fire after this explanation is visible, so they can read it and decide in context.

Example format:

> **About to run a destructive action:**
> **Command:** `git reset --hard origin/main`
> **What:** Discards all local uncommitted changes and any local commits not pushed, resetting the branch to match `origin/main` exactly.
> **Why:** Branch is in a bad state after a failed rebase; this returns it to a known-good starting point.
> **Scope:** This local branch only. Remote is untouched. No data outside this working tree affected.
> **Rollback:** If you have uncommitted work, it's gone. Committed work can be recovered via `git reflog` for ~90 days.
> **Blast radius:** Local only.

This requirement applies to every code session working on this repo. Do not skip it even when "obvious" — Zach has specifically asked to see the context before approving destructive actions.

---

## Two-Tier QA Gate (Mandatory Before Every Merge)

Every PR must pass **both** tiers before merging to main.

### Tier 1 — Automated (blocking)

Run before opening or updating any PR:

```bash
npm test                                    # unit tests
npx playwright test tests/smoke/ tests/journey/ --reporter=line
```

All tests must be green. If a test fails due to pre-existing KV state, reset the relevant flags to OFF via the production API (using `INQ_SECRET`) before re-running — never skip or suppress failing tests.

### Tier 2 — Visual walkthrough (human, async)

After Tier 1 passes, queue a visual walkthrough using Chrome MCP or computer-use:

- Verify the feature's golden path at iPhone 375px, iPad 768px, and desktop 1280px.
- Check that gated features (behind a feature flag) are **not visible** when the flag is OFF.
- Confirm no regressions on the pipeline kanban, quote builder, and calendar pages.
- Tier 2 may be deferred until the user returns, but it must be completed before declaring a feature "done."

Flag any Tier 2 issues as follow-up tasks; do not hold up merges for cosmetic-only findings unless the feature is visually broken.

---

## SMS Sender Lockdown

Outbound SMS must always originate from the verified Twilio number registered to Blu's BBQ.

- Never hardcode a different `from` number in any SMS send path.
- The Twilio account SID and auth token live in environment variables (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`). Never log or expose these values.
- Before sending, confirm the `to` number is a real customer number pulled from the inquiry record — never send to a hardcoded test number in production code.
- SMS send paths live under `api/sms/`. New SMS features go there; do not inline Twilio calls in cron handlers or other API routes.
- **DO NOT TOUCH:** `api/sms/send.js` (once created) carries the same "no accidental send from wrong number" invariant as `api/dispatch/email.js`.

---

## Payment Provider Abstraction

All payment processing must go through a provider-agnostic adapter in `api/payments/providers/`.

- No Stripe, Square, or other payment-SDK calls outside of `api/payments/providers/`.
- Each provider implements a common interface: `{ charge, refund, getStatus }`.
- The active provider is selected via environment variable (`PAYMENT_PROVIDER=stripe|square`). Default to `stripe` if unset.
- Never store raw card numbers or full PANs anywhere — not in KV, not in logs, not in inquiry records.
- Deposit amounts recorded in KV (`deposits:{threadId}`) store only the amount and a provider transaction ID, never card data.
- If switching providers, add a new file under `api/payments/providers/` and update the adapter selector — do not modify existing provider files.

---

## New Feature Modularity

Big features must live in their own folder or dedicated module. Do not inline large features into `index.html` or existing catch-all files.

### Rules

1. **New API feature group → own folder.** Create `api/{feature}/` with one file per endpoint. Example: `api/sms/send.js`, `api/payments/providers/stripe.js`.
2. **New client feature → own JS module.** Create `static/js/{feature}.js`. Load it via a `<script src="...">` tag in `index.html`. Register it in `STATIC_MODULE_FILES` in `api/self-modify.js` so the AI dashboard can edit it.
3. **New CSS → own file.** Create `static/css/{feature}.css` and link it in `index.html`. Register in `STATIC_MODULE_FILES`.
4. **Do not retrofit** existing features — this rule is forward-only. Do not refactor Groups 1–9 into folders unless that is the explicit task.
5. **Flag-gate all new features.** Add an entry to `SEED_FLAGS` in `api/_lib/flags.js` (default OFF). Gate the UI block with `window.flags.isEnabled('{flag}')` and gate the API handler with `await getFlag('{flag}')`.
6. **Add routes to `vercel.json`.** Every new API file needs a rewrite entry; every new cron needs a cron entry.

### Example structure for a new "comms" feature

```
api/sms/send.js          ← SMS send endpoint
api/sms/status.js        ← delivery status webhook
static/js/comms.js       ← client module (gated by sms_channel flag)
static/css/comms.css     ← styles
```

All four files go into `STATIC_MODULE_FILES`. The flag `sms_channel` already exists in `SEED_FLAGS`.
