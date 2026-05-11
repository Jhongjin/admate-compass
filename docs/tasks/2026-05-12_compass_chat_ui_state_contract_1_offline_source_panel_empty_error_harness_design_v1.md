# Compass Chat UI State Contract 1 Offline Source Panel Empty/Error Harness Design v1

Date: 2026-05-12
Status: docs-only design plan
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`

## Purpose

Design a future offline harness for Compass chat/source UI state contracts,
focused on source-panel empty and error states. This task does not implement
fixtures, checkers, source code, package scripts, API behavior, RAG behavior, or
database behavior.

The intended future harness should verify that the chat answer area and source
panel present consistent user-facing states for:

- `source-found`
- `noData`
- `generation-limited`
- `error`
- initial/empty source panel

## Current UI Surface Baseline

Current surfaces inspected for this design:

- `src/app/chat-ollama/page.tsx`
  - authenticated chat route
  - two/three panel desktop shell
  - compact mobile source surface below messages
  - right panel collapse behavior
  - latest assistant message drives source panel state
- `src/components/chat/ChatBubble.tsx`
  - inline answer card
  - inline source toggle
  - noData copy
  - generation-limited copy when `model === "ollama-connection-failed"`
  - runtime status badges
- `src/components/chat/RelatedResources.tsx`
  - right/compact source panel card
  - source-found card list
  - noData/empty state
  - generation-limited preserved-source banner
  - source card expand/collapse

Observed current state drivers:

- `sources.length > 0`
- `noDataFound === true`
- `model === "ollama-connection-failed"` with sources
- API fetch catch path creates an assistant error message with `sources: []`
- before any user question, the right panel shows an initial prompt to start a
  question

## Non-Goals And No-Touch Boundaries

This design does not authorize edits to:

- `src/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `docs/rag`
- API routes
- RAG services
- database schema, migrations, SQL, import, crawler, embedding, or reembedding
  paths

This design does not authorize:

- production execution
- login
- chat prompt submission
- browser automation
- production or local RAG calls
- DB reads or writes
- env or secret reads
- fixture/checker implementation
- package script wiring

## Future Fixture Candidates

Future fixture storage candidate, pending separate approval:

```text
docs/rag/compass-chat-ui-state-contract-fixtures.json
```

Alternative if reviewers prefer keeping UI contract fixtures under tasks until
adoption:

```text
docs/tasks/evidence/2026-05-12_compass_chat_ui_state_contract_1/chat-ui-state-fixtures.json
```

Recommended fixture shape:

| Field | Purpose |
| --- | --- |
| `id` | stable fixture id |
| `synthetic` | must be `true` |
| `routeSurface` | `chat-ollama` |
| `viewportClass` | `desktop`, `tablet`, `mobile` |
| `state` | one of the approved UI states |
| `message` | synthetic assistant/user message payload |
| `sources` | synthetic source array, never production-derived |
| `expectedVisibleText` | required user-visible text fragments |
| `expectedHiddenText` | guarded implementation/internal fragments |
| `expectedControls` | source toggle, expand, open/download, retry, contact, etc. |
| `panelExpectation` | right panel or compact mobile expectation |
| `notes` | reviewer-only rationale |

Fixture ids to consider:

- `chat-ui-initial-empty-source-panel`
- `chat-ui-source-found-three-sources`
- `chat-ui-source-found-long-korean-title`
- `chat-ui-nodata-empty-source-panel`
- `chat-ui-generation-limited-sources-preserved`
- `chat-ui-error-no-sources`
- `chat-ui-mobile-source-found-compact-panel`
- `chat-ui-mobile-nodata-compact-panel`
- `chat-ui-mobile-generation-limited-compact-panel`
- `chat-ui-mobile-error-no-panel-trap`

## Future Checker Candidates

Future checker candidate, pending separate approval:

```text
scripts/check-compass-chat-ui-state-contract-fixtures.mjs
```

Future package script candidate, pending separate approval:

```text
npm run check:compass-chat-ui-state-contract
```

Future `verify:harness` candidate:

```text
node scripts/check-compass-chat-ui-state-contract-fixtures.mjs
```

Checker responsibilities should stay offline and deterministic:

- parse committed synthetic fixtures only
- verify required state coverage
- verify state-specific required visible text
- verify guarded internal text is excluded
- verify no fixture requests production, login, RAG, DB, browser, or secrets
- verify mobile fixtures specify compact-panel boundaries
- report `productionApiCalled: false`
- report `ragSearchExecuted: false`
- report `browserUsed: false`
- report `dbTouched: false`

Checker should not:

- import React components
- render the browser
- call `/api/chat-ollama`
- run Next.js
- read `.env*`
- inspect production screenshots
- mutate fixture files

## State Matrix

| State | Answer expectation | Source panel expectation | Inline source expectation | Guarded hidden text |
| --- | --- | --- | --- | --- |
| `initial-empty` | greeting only; no answer claim | start-question empty state in right panel | no source toggle | raw fields, source counts, RAG internals |
| `source-found` | answer is readable and grounded | `근거 문서` with count and cards | `근거 문서 N개 보기` available | `schema`, `sourcesCount`, `retrievalMethod`, `sourceQuality`, vector/hybrid scores unless deliberately user-labeled |
| `noData` | vendor-neutral no-data copy; no unsupported answer | `근거 문서 없음` and helpful narrowing guidance | no verified-source affordance | source card shells, accepted/verified language, raw internals |
| `generation-limited` | generation limit is clear; retrieved evidence is preserved | source cards remain visible with limitation banner | source toggle remains available when sources exist | failure stack, model ids beyond user-safe copy, raw retrieval internals |
| `error` | temporary service/error copy; no source claim | empty/error-safe source state or unchanged initial state | no source toggle when sources are empty | stack traces, API paths, tokens, provider payload, retry internals |

## State-Specific Expectations

### Source Found

Expected:

- answer card shows `Compass 답변`
- answer card shows source confidence only as user-facing labels
- source affordance appears when `sources.length > 0`
- right panel/compact panel shows `근거 문서`
- source count matches fixture count after fallback filtering
- source cards include title and excerpt or safe fallback excerpt copy
- open/download icon appears only when a URL exists
- expanded card may show trust labels, but not raw implementation fields
- long Korean titles and excerpts wrap within card boundaries

Must not show:

- `schema=compass`
- `sourcesCount`
- `retrievalMethod`
- `sourceQuality`
- `hybridScore`
- `ollama_document_chunks`
- `RAGSearchService`
- raw source/provider/payload text

### noData

Expected:

- answer card shows vendor-neutral noData copy:
  - Compass could not find usable evidence in current documents
  - user can narrow platform, policy item, or creative type
- right panel/compact panel shows `근거 문서 없음`
- no source cards are shown as verified evidence
- contact/escalation copy, if present, does not imply policy approval
- noData state remains distinct from generation failure

Must not show:

- generic source cards as if they answer the unavailable target
- accepted/verified labels
- unsafe policy speculation such as "allowed", "safe", or "no issue" for the
  unsupported target

### Generation Limited

Expected:

- answer card clearly says generation is temporarily limited
- retrieved source evidence remains visible when sources exist
- right panel/compact panel shows `생성 답변 제한`
- source cards remain inspectable
- source count is preserved
- state is distinct from noData and generic error

Must not show:

- source clearing solely because answer generation failed
- provider stack traces or transport internals
- a noData empty state when valid sources exist

### Error

Expected:

- answer card shows temporary service/error copy
- source panel does not invent evidence
- empty/error state does not block chat input
- retry/new-chat controls, if present in the UI shell, remain reachable
- no stored source count is displayed for the failed turn unless an explicit
  previous-answer context is shown

Must not show:

- stack traces
- raw API route failure payloads
- tokens, cookies, credentials, signed URLs, or env names
- "verified source" or source-found labels when sources are empty

### Initial Empty

Expected:

- chat area shows initial Compass greeting only
- right panel says the user can start a question
- quick questions may be present, but no answer-specific source claim appears
- mobile compact source panel is absent before a user question

Must not show:

- source count
- source card shell
- error copy
- noData warning copy before a query exists

## Mobile Shell Boundaries

The future offline contract cannot prove pixels without a browser, but fixtures
can still require reviewers to preserve the following mobile boundaries when a
separate UI or screenshot gate is approved:

- below `1024px`, the desktop right panel is collapsed and the compact source
  surface is rendered below messages after at least one user question
- compact source panel must stay inside the chat scroll area
- compact panel must not permanently cover the input bar
- source cards must be scrollable with the message list, not trapped in an
  unreachable fixed panel
- long Korean titles, excerpts, badges, and buttons must wrap without
  horizontal page scroll
- source expand/collapse controls must remain finger-target sized
- noData and error states must not create a dead-end overlay
- history sheet and account/header controls are out of this contract except
  where they overlap the source surface

Recommended future viewport labels for fixture metadata:

- `desktop-lg`: `1440x900`
- `tablet`: `768x1024`
- `mobile`: `390x844`
- `small-mobile`: `360x740`

## Validation Plan For This Docs Task

Run only docs-safe/offline commands:

```powershell
git diff --check -- docs/tasks/2026-05-12_compass_chat_ui_state_contract_1_offline_source_panel_empty_error_harness_design_v1.md
npm run verify:harness
```

`npm run verify:harness` is considered safe for this task because current
package wiring runs deterministic local Node checkers against committed
fixtures and is documented to avoid production API calls, live RAG retrieval,
DB mutation, crawler/import, embedding, reembedding, browser use, login, and
secret reads.

Expected validation signals:

- diff check passes
- existing RAG contract checker passes
- existing source-quality sample checker passes
- existing RAG fixture evaluator passes
- existing noData boundary checker passes
- existing Compass Evidence QA checker passes
- existing admin/debug surface checker passes
- harness reports no production/RAG execution where those signals exist

## Future Approval Gates

Recommended next gates:

1. `Compass-Chat-UI-State-Contract-2 Fixture Contract Approval`
   - approve exact fixture location and JSON shape
   - still no source/API/RAG/DB edits

2. `Compass-Chat-UI-State-Contract-3 Offline Checker Implementation`
   - add synthetic fixtures and checker only
   - wire checker into harness only if approved

3. `Compass-Chat-UI-State-Contract-4 UI Screenshot Review Plan`
   - plan browser/screenshot validation separately
   - requires explicit approval because this task forbids browser and login

## Boundary Confirmation

This document is the only in-scope artifact for this task:

```text
docs/tasks/2026-05-12_compass_chat_ui_state_contract_1_offline_source_panel_empty_error_harness_design_v1.md
```

No code, package, API, RAG, DB, fixture, checker, production, login, browser,
chat prompt, or secret-reading work is included in this design gate.
