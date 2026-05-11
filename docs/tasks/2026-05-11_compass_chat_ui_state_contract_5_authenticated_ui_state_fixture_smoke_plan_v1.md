# Compass Chat UI State Contract 5 Authenticated UI State Fixture Smoke Plan v1

Date: 2026-05-11
Status: docs-only gated smoke plan
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`
Basis:

- current synthetic contract: `docs/rag/compass-chat-ui-state-contract-fixtures.json`
- prior no-session smoke: `docs/tasks/2026-05-11_compass_chat_ui_state_contract_4_post_deploy_ui_state_smoke_result_v1.md`

## 1. Goal

Define the next human-gated authenticated UI state fixture smoke for
`/chat-ollama` after the no-session smoke confirmed that production redirects
unauthenticated users to login and does not expose the chat shell.

This gate is a UI-state and evidence-capture plan only. It does not authorize
production prompt submission, live RAG execution, API calls, database access,
fixture mutation, code changes, crawler/import work, embedding, reembedding, or
secret/env inspection.

## 2. Human Gate

This smoke may start only after the user explicitly approves all of the
following:

- target environment and URL
- use of a user-controlled authenticated browser session
- screenshot capture boundaries
- approved fixture candidate list
- whether the operator may use an existing logged-in session or must wait for
  the user to perform login manually

The operator must not type credentials, inspect cookies, read local storage,
read session storage, export tokens, inspect provider payloads, or open `.env*`.

## 3. Approved Fixture Candidates

Use only the committed synthetic fixtures below as the intended visual-state
references. They are not production prompts and must not be submitted to the
chat API.

| UI state | Approved fixture candidate(s) | Viewport target | Smoke intent |
| --- | --- | --- | --- |
| `initial-empty` | `chat-ui-initial-empty-source-panel` | `desktop-lg` plus authenticated mobile shell | Confirm greeting and empty source panel after login without sending a prompt. |
| `source-found` | `chat-ui-source-found-three-sources`, `chat-ui-source-found-long-korean-title` | `desktop-lg` | Confirm answer/source affordances, source counts, cards, URL controls, and long Korean wrapping. |
| `noData` | `chat-ui-nodata-empty-source-panel` | `desktop-lg` | Confirm no-data copy, no source cards, and no approval/verified-source language. |
| `generation-limited` / Ollama failure | `chat-ui-generation-limited-sources-preserved` | `desktop-lg` | Confirm limitation copy while source cards remain inspectable. |
| mobile source panel | `chat-ui-mobile-source-found-compact-panel`, `chat-ui-mobile-nodata-compact-panel`, `chat-ui-mobile-generation-limited-compact-panel`, `chat-ui-mobile-error-no-panel-trap` | `390x844`, `360x740` | Confirm compact source surfaces stay inside chat scroll, do not cover composer, and do not render a desktop right panel. |
| error | `chat-ui-error-no-sources`, `chat-ui-mobile-error-no-panel-trap` | desktop and mobile | Confirm temporary error copy without invented evidence or blocked recovery controls. |

No new fixtures are approved by this plan. Changing fixture IDs, fixture shape,
expected text, source metadata, scripts, or package wiring requires a separate
implementation gate.

## 4. Allowed Smoke Actions

Allowed after explicit user approval:

- open `/chat-ollama` in an already authenticated or user-login-completed
  browser session
- observe the authenticated initial state without sending a prompt
- compare visible UI surfaces against the approved synthetic fixture
  expectations
- capture screenshots of UI layout only within the approved evidence boundary
- record visible text, viewport size, URL path, and whether source panels/cards
  appear
- run local static/offline checks listed in this document

Allowed only if the user separately approves a non-production fixture/story
harness:

- render approved synthetic fixture candidates in a non-production UI fixture
  surface
- capture visual evidence for source-found, noData, generation-limited, error,
  and mobile compact panel states from that non-production surface

## 5. Explicit No-Touch Boundaries

Not allowed in this gate:

- login performed by the operator
- production prompt submission
- production `/api/chat-ollama` requests
- production fixture execution
- RAG retrieval, ranking, generation, embeddings, reembedding, crawler, import,
  or corpus mutation
- database reads, writes, migrations, grants, SQL execution, or Supabase console
  access
- source code changes under `src/`
- API route, service, script, package, fixture, asset, SQL, or env changes
- `.env*`, cookie, token, local storage, session storage, credential, provider
  payload, signed URL, or secret inspection
- commit, push, deploy, or staging changes

## 6. Screenshot And Evidence Boundary

Evidence may include:

- desktop screenshot at `1440x900`
- mobile screenshots at `390x844` and `360x740`
- sanitized notes listing visible user-facing text and layout findings
- local checker output for the synthetic contract

Evidence must not include:

- email addresses or account identifiers unless the user explicitly approves
  redaction-safe capture
- cookies, tokens, storage values, headers, request/response payloads, network
  traces, console secrets, provider payloads, or stack traces
- full production prompt text, generated production answers, or production
  source payloads unless separately approved
- database IDs or private corpus internals

Recommended evidence folder, only if screenshots are approved:

```text
docs/tasks/evidence/2026-05-11_compass_chat_ui_state_contract_5/
```

Creating that folder or adding images is out of scope for this docs-only plan
unless the user approves the smoke execution gate later.

## 7. State Checks

### Initial Authenticated State

Required:

- authenticated `/chat-ollama` shell loads after user-approved login/session
- greeting is visible
- desktop right source panel invites the user to start a question
- mobile initial state does not show a compact source panel before a query
- composer remains visible and reachable

Must not show:

- source count
- source card shell
- noData warning before a query
- error copy before a query
- internal contract or RAG fields

### Source Found

Preferred source: approved non-production fixture/story harness.

Required:

- answer area shows user-facing `Compass 답변` style answer affordance
- source toggle/count matches approved fixture candidate
- desktop panel heading is `근거 문서`
- source cards show title and excerpt safely
- long Korean title/excerpt wraps without horizontal page overflow
- URL/open controls appear only where source URL exists

Must not show raw implementation fields, source-quality internals, provider
payloads, or unsupported approval language.

### noDataFound

Preferred source: approved non-production fixture/story harness.

Required:

- no-data guidance is visible
- desktop or compact source surface says `근거 문서 없음`
- no source cards are displayed as evidence
- wording does not imply acceptance, approval, safety, or verified evidence
- composer/recovery path remains usable

### Generation-Limited / Ollama Failure

Preferred source: approved non-production fixture/story harness.

Required:

- limitation copy is visible
- panel heading is `생성 답변 제한`
- retrieved source cards remain inspectable when sources exist
- state is visually distinct from noData and generic error
- no provider stack, model internals, transport details, or API route path is
  exposed

### Error

Preferred source: approved synthetic/non-production setup. Do not force a
production failure.

Required:

- temporary error copy is visible
- panel shows safe empty/error state with no invented evidence
- retry/new-chat/input recovery controls remain reachable where available
- mobile error state does not trap a compact panel over the composer

## 8. Desktop And Mobile Source Panel Checks

Desktop `1440x900`:

- authenticated shell stays within viewport
- no horizontal page overflow
- answer, composer, history rail, and right source panel do not overlap
- panel headings match active state
- cards have bounded width and wrapped Korean text
- icon controls stay visible without layout shift

Mobile `390x844` and `360x740`:

- desktop right source panel is not visible as a column
- compact source panel appears only after a relevant answer state
- compact panel stays inside the chat scroll area
- compact panel does not permanently cover the composer
- badges, titles, excerpts, and controls wrap without horizontal overflow
- expand/open/download controls remain finger-target sized
- noData and error states do not create a dead-end overlay

## 9. Stop Conditions

Stop immediately and record `BLOCKED` if any of the following is required to
continue:

- the user has not approved login/session use
- credentials would need to be entered by the operator
- a production prompt or direct production API request would be needed
- a production failure would need to be forced
- RAG/API/DB/crawler/import/reembedding/embedding mutation would be needed
- env, token, cookie, storage, or secret inspection would be needed
- a screenshot would expose unapproved account or private production data
- fixture, script, package, source, SQL, or asset edits would be needed
- the authenticated UI shows unexpected private or sensitive data that cannot
  be safely redacted

## 10. Pass Criteria

This gate can pass only when:

- user login/session approval is recorded for authenticated observation
- no operator-handled credentials or secret/storage inspection occurred
- initial authenticated state is observed without submitting a prompt
- non-initial states are either verified through an approved non-production
  fixture/story harness or remain explicitly blocked
- desktop and mobile source panel boundaries are checked where approved
- forbidden internal terminology is absent from captured UI surfaces
- no RAG/API/DB/reembedding/crawler/import/corpus mutation occurred
- all local static/offline validations pass or are documented with reason

## 11. Validation For This Docs Task

Run only local static/offline checks:

```powershell
git diff --check -- docs/tasks/2026-05-11_compass_chat_ui_state_contract_5_authenticated_ui_state_fixture_smoke_plan_v1.md
npm run verify:harness
npm run type-check
```

`npm run build` is optional and should be skipped if it would load application
environment, require secrets, call external services, or exceed the docs-only
validation boundary.

## 12. Boundary Confirmation

This document is the only intended changed artifact:

```text
docs/tasks/2026-05-11_compass_chat_ui_state_contract_5_authenticated_ui_state_fixture_smoke_plan_v1.md
```

Leave the file unstaged. Do not commit or push.
