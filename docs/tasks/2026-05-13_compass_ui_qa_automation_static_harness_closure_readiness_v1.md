# Compass UI QA Automation Static Harness Closure Readiness v1

Date: 2026-05-13 KST
Status: docs-only closure / authenticated QA readiness
Repo: admate-compass

## Decision

No additional non-human-gated static/offline guard is recommended for this
round.

The current static harness now covers the safe local layers that can be checked
without a browser session:

- prompt-visible QA evidence records
- local fixture prompt binding
- development-only fixture renderer prompt binding
- source/evidence panel rendering contract
- mobile compact-panel fixture expectations
- noData/source-preservation regression pairing

Further validation of the live authenticated Compass chat surface requires a
human-controlled authenticated browser or an explicitly provided attachable
remote-debug session. A normal logged-in browser is not sufficient for agent QA
because this queue must not inspect cookies, sessions, tokens, browser storage,
or other auth material.

## Current Guard Coverage

Committed local/static checks:

- `npm run check:compass-qa-evidence-prompt-visible`
- `npm run check:compass-chat-ui-state-contract`
- `npm run check:compass-dev-fixture-renderer`
- `npm run check:compass-source-panel-rendering`
- `npm run check:nodata-boundary`
- `npm run verify:harness`

The guards assert that future QA evidence and fixtures keep:

- visible prompt text before pass/fail evidence is accepted
- result-to-prompt linkage
- noData states distinct from source-found states
- generation-limited states preserving available sources
- mobile source panel rendering as compact in-chat UI
- no raw provider/source/internal implementation fragments in user-facing
  fixture expectations
- no local static harness side effects such as production API calls, browser
  auth use, RAG execution, or DB mutation

## Authenticated QA Boundary

Human-gated:

- live authenticated Compass chat prompt submission
- production source panel screenshot capture
- mobile authenticated browser visual QA
- source card open/download behavior against live authenticated data
- any verification that depends on a valid user session

Not allowed for this queue:

- production valid prompts or production API calls
- login, session, cookie, token, or browser storage access
- RAG search execution
- DB/schema/crawler/reembedding mutation
- raw source/provider payload inspection
- secret or environment value output
- stage, commit, or push

## Recommended Next Gate

Gate `Compass-Authenticated-QA-Source-Panel-Human-1`:

- human opens authenticated Compass in a controlled browser
- submit the approved QA prompts once
- capture sanitized screenshots only after the exact prompt is visible
- record only status, visible state, source count class, and sanitized UI copy
- do not capture cookies, tokens, storage, raw provider payloads, source hashes,
  or sensitive account data

If no attachable browser or human screenshot handoff is available, keep the
queue paused and rely on `npm run verify:harness` for local regression coverage.

## Verification

Completed local verification:

- PASS `npm run verify:harness`
- PASS `git diff --check -- docs/tasks/2026-05-13_compass_ui_qa_automation_static_harness_closure_readiness_v1.md`
- PASS `git diff --cached --name-only` returned no staged files
