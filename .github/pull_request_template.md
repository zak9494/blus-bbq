## What does this PR do?

<!-- One sentence. What changed and why. -->

## Checklist

- [ ] **Single concern** — this PR changes exactly one thing (feature, fix, refactor, or chore). If it does more, split it.
- [ ] **Flag-gated** — new UI/behaviour is behind a feature flag. Flag name: `___________`. Default: OFF.
- [ ] **Playwright journey test** added or updated (path: `tests/journey/`). Test covers the flag-ON golden path.
- [ ] **Tier 2 walkthrough** needed? `[ ] Yes — queued` / `[ ] No — not UI-facing`
- [ ] **No new hardcoded PII** — no email addresses, phone numbers, addresses, real names, or brand colours in source code. Env-var-first.
- [ ] **Tenant-aware-ready** — any new KV read/write uses `getTenantId(req)`-shaped helper, or is tagged `// TODO: tenant-scope` for later retrofit.
- [ ] **Rollback plan** — which flag toggle reverts this? `___________` flipped OFF reverts all visible changes.

## Test evidence

<!-- Paste the npm test + Playwright output summary, or link to the CI run. -->

```
npm test: X/X pass
Playwright smoke: X pass, 0 fail
```
