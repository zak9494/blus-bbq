# Journey Tests

This folder holds **user-journey tests** — multi-step flows that cross feature boundaries and simulate real operator behavior.

## What belongs here

Journey tests cover complete task sequences: "create inquiry → approve → generate quote → send email" or "receive lead → review → book → mark completed." Each test exercises the system as a whole, not just individual components.

Contrast with `tests/smoke/`:
- **Smoke tests** verify that pages load and flags gate features correctly.
- **Journey tests** verify that sequences of actions produce correct end-to-end outcomes.

## Conventions

- One file per user story (e.g., `booking-flow.spec.js`, `quote-send.spec.js`).
- Each test file exports a `describe` block that uses `BASE_URL` from `process.env.SMOKE_BASE_URL`.
- Reset flags in `beforeAll` using `INQ_SECRET` (same pattern as smoke tests).
- Tests must be idempotent — clean up any KV state they write.
- Tag slow tests with `test.slow()` to keep CI aware of the timeout budget.

## Running locally

```bash
# Against production
SMOKE_BASE_URL=https://blus-bbq.vercel.app npx playwright test tests/journey/ --reporter=line

# Against a preview URL
SMOKE_BASE_URL=<preview-url> npx playwright test tests/journey/ --reporter=line

# Both smoke + journey (mirrors CI)
SMOKE_BASE_URL=<url> npx playwright test tests/smoke/ tests/journey/ --reporter=line
```

## CI

Journey tests run automatically on every PR alongside the smoke suite (see `.github/workflows/smoke.yml`). Both suites must be green before merging.
