# Compass Chat UI State Contract 4 Post-Deploy UI State Design Smoke Plan v1

Date: 2026-05-11
Status: docs-only plan
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`
Base commit: `3d4f2cd3b fix: align Compass chat UI states`

## 1. Goal

Define the next safe gate after commit `3d4f2cd3b` for post-deploy UI
state/design smoke coverage on `/chat-ollama`.

This gate focuses on visual and user-facing state checks only. It does not
authorize production RAG queries, fixture execution against production,
database reads/writes, API changes, RAG changes, environment inspection, asset
changes, or source code edits.

## 2. Smoke Boundary

Allowed in this gate:

- inspect the deployed `/chat-ollama` page shell after deployment is confirmed
- verify unauthenticated redirect behavior without entering credentials
- if the user explicitly provides or approves an authenticated browser session,
  inspect UI layout/state surfaces without submitting production chat prompts
- review committed synthetic fixture contracts through the offline checker
- capture sanitized observations about visible UI text and layout only

Not allowed in this gate:

- submit live production chat prompts
- execute production RAG, retrieval, embeddings, reembedding, crawler, import,
  or generation paths
- call production `/api/chat-ollama` directly
- run production fixture suites
- read `.env*`, secrets, cookies, tokens, session storage, provider payloads, or
  signed URLs
- edit `src/`, API routes, RAG services, DB/SQL, env files, fixtures, assets, or
  package wiring

## 3. Required UI States

The smoke should cover these states by observation, offline fixtures, or
pre-approved synthetic/non-production setup:

| State | Required check | Production-query boundary |
| --- | --- | --- |
| `initial-empty` | Greeting is visible; source panel invites the user to start a question; no source count or warning state appears. | Can be checked after login without submitting a prompt. |
| `source-found` | Answer/source affordances are readable; source cards show user-facing title/excerpt/count; long Korean text wraps. | Requires approved non-production fixture or explicit approval for one production prompt. |
| `noData` | User sees no-data guidance and no verified-source claim; source panel shows no evidence cards. | Requires approved non-production fixture or explicit approval for one production prompt. |
| `generation-limited` | Limitation copy is clear while any retrieved sources remain inspectable. | Requires approved non-production fixture or explicit approval for one production prompt. |
| `error` | Temporary error copy is visible; no evidence is invented; recovery controls/input remain reachable. | Prefer non-production or synthetic setup; do not force production failure. |

## 4. Desktop Layout Checklist

Desktop target viewport:

```text
1440x900
```

Check:

- authenticated shell keeps the answer area, composer, history rail, and source
  panel within the viewport
- no horizontal page overflow
- source panel heading reflects the active state:
  - `근거 문서` for `source-found`
  - `근거 문서 없음` for `noData` and source-empty error states
  - `생성 답변 제한` for `generation-limited`
- source cards use bounded cards with wrapped titles/excerpts
- icon controls for open/download/expand stay visible and do not shift layout
- error/noData states do not render empty source-card shells as if evidence
  exists

## 5. Mobile Layout Checklist

Mobile target viewports:

```text
390x844
360x740
```

Check:

- desktop source panel is not rendered as a visible column on mobile
- compact source state appears below messages only after there is a relevant
  answer state
- compact source surface stays in the chat scroll area
- compact source surface does not permanently cover the composer
- long Korean titles, excerpts, badges, and controls wrap without horizontal
  overflow
- expand/open/download controls remain finger-target sized
- `noData` and `error` states do not create a dead-end overlay
- initial mobile state does not show a source panel before a query exists

## 6. Forbidden Internal Terminology

The following must not appear in user-facing UI during this smoke:

```text
schema=compass
sourcesCount
retrievalMethod
sourceQuality
hybridScore
vectorScore
keywordScore
ollama_document_chunks
RAGSearchService
raw source
raw provider
raw payload
provider payload
stack trace
/api/chat-ollama
token
cookie
credential
secret
signedUrl
apiKey
privateKey
authorization
bearer
password
.env
SUPABASE
GEMINI
ANTHROPIC
OPENAI
```

Also avoid policy-approval language in unsupported states:

```text
verified source
accepted
allowed
safe
no issue
```

Those terms are forbidden when the active state is `noData`, `error`, or
`initial-empty`.

## 7. Login And Production Fixture Approval Lines

Requires user login or an already-authenticated user-approved browser session:

- viewing `/chat-ollama` beyond the login redirect
- checking authenticated desktop/mobile shell layout
- checking initial authenticated greeting and empty source panel
- capturing screenshots or measurements from the authenticated route

Requires separate explicit approval before execution:

- any production chat prompt submission
- any production `/api/chat-ollama` request
- any production fixture execution, even if read-only
- any test that intentionally attempts to trigger source-found, noData,
  generation-limited, or error through live production RAG behavior
- any browser automation that reads cookies, tokens, local storage, session
  storage, provider responses, or secrets

Preferred path for non-initial states:

- use the committed offline synthetic contract via
  `npm run check:compass-chat-ui-state-contract`
- if visual verification is needed, create a separate approved non-production
  fixture/story/harness gate before touching production behavior

## 8. Proposed Execution Sequence

1. Confirm deployment target and commit alignment for `3d4f2cd3b`.
2. Visit production `/chat-ollama` unauthenticated and confirm redirect to
   login without entering credentials.
3. If the user approves login, inspect authenticated initial state on desktop
   and mobile without submitting a prompt.
4. Run the offline UI state contract checker locally.
5. Record which non-initial states remain blocked by the no-production-query
   boundary.
6. Stop before any live production prompt or fixture execution unless the user
   explicitly approves that expansion.

## 9. Pass Criteria

This gate passes when:

- the plan boundaries are preserved
- unauthenticated `/chat-ollama` does not expose the chat shell
- authenticated initial state, if approved, keeps source UI empty and stable
- offline UI state contract checker passes
- desktop/mobile layout checks do not find horizontal overflow or blocked input
- no forbidden internal terminology is visible in inspected UI surfaces
- source-found/noData/generation-limited/error states are either verified
  offline or explicitly marked blocked pending approved non-production/production
  execution

## 10. Validation For This Docs Task

Run:

```powershell
git diff --check -- docs/tasks/2026-05-11_compass_chat_ui_state_contract_4_post_deploy_ui_state_design_smoke_plan_v1.md
npm run check:compass-chat-ui-state-contract
npm run type-check
```

The commands are docs-safe/local for this task. They do not authorize production
browser use, production RAG queries, DB access, env reads, or fixture execution
against production.

## 11. Boundary Confirmation

This document is the only intended changed artifact:

```text
docs/tasks/2026-05-11_compass_chat_ui_state_contract_4_post_deploy_ui_state_design_smoke_plan_v1.md
```

Leave the file unstaged. Do not commit or push.
