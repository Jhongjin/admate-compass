# Compass Chat UI State Contract 13 Authenticated Production Source Panel QA Blocked Status v1

Date: 2026-05-12
Status: blocked / human-gated
Repo: admate-compass
Follows: `8594445e8 docs: checklist Compass authenticated source panel QA`

## Purpose

Record the next queue decision after the authenticated source panel QA
checklist. The meaningful next validation requires an approved authenticated
production session and screenshot/evidence policy, so it was not executed by
default.

## Blocker

Authenticated production UI QA is blocked until a human explicitly confirms:

- production target URL and expected deployed commit
- approved QA account/session type, without sharing credentials
- whether screenshots are allowed and where redacted evidence should be stored
- whether prompt submission is allowed; default remains no prompt submission
- whether existing visible chat/source states are enough for inspection
- stop conditions for any personal data, provider payload, token, cookie,
  session, signed URL, or internal debug text exposure

## Safe Work Completed

No production browser session was opened for authenticated inspection. No prompt
was submitted, and no direct or indirect `/api/chat-ollama` call was made.

The existing checklist already defines the visual review scope:

- desktop source panel position and non-overlap
- mobile source panel behavior and composer visibility
- long Korean source title wrapping
- source card, excerpt, and open-control readability
- empty, no-data, error, and limited states
- absence of internal/provider/security text in user-facing UI

## No-Touch Confirmation

This gate did not perform:

- login or authenticated browsing
- production prompt submission
- direct API calls
- RAGSearchService or `/api/chat-ollama` changes
- DB, schema, crawler, import, embedding, or reembedding work
- env, token, cookie, session, signed URL, or provider payload inspection
- fixture, package, or source code changes
- screenshot capture

## Next Gate

Gate Compass-Chat-UI-State-14 authenticated source panel production visual QA
execution can start only after the blocker inputs above are confirmed.

If approval is not available, continue with unrelated offline/static Compass
queues and keep this authenticated QA blocked.

## Verification

Required local verification for this docs-only gate:

```text
git diff --check
npm run type-check
npm run build
npm run verify:harness
```

Result:

```text
git diff --check: pass
npm run build: pass
npm run type-check: pass after build regenerated .next/types
npm run verify:harness: pass
```

Note: the first `npm run type-check` attempt ran before `.next/types` had been
regenerated and failed on missing generated Next type files. `npm run build`
recreated those files, and the follow-up `npm run type-check` passed without
code changes.
