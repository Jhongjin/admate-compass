# Compass Chat UI State Contract 7 Fixture Harness Implementation Plan v1

Date: 2026-05-11
Status: docs-only implementation plan
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`
Preceded by: `docs/tasks/2026-05-11_compass_chat_ui_state_contract_6_fixture_harness_feasibility_audit_v1.md`

## Purpose

Plan a future safe local, non-production fixture renderer for Compass chat UI
state review.

QA6 found no existing story/demo/render harness for the committed Compass chat
UI state fixtures. It did find a safe deterministic fixture contract:

```text
docs/rag/compass-chat-ui-state-contract-fixtures.json
scripts/check-compass-chat-ui-state-contract-fixtures.mjs
npm run check:compass-chat-ui-state-contract
npm run verify:harness
```

This gate is a planning artifact only. It does not implement the renderer,
extract components, add routes, add package scripts, change fixture JSON, run
browser automation, submit chat prompts, or touch auth/API/RAG/DB/env surfaces.

## Recommendation

Approve a future scoped implementation gate for a local fixture renderer, with
the default architecture:

1. Extract `SourceStatePanel` from `src/app/chat-ollama/page.tsx` into a
   reusable non-route component.
2. Keep `src/app/chat-ollama/page.tsx` as the production route consumer of that
   component.
3. Add a local non-production renderer that consumes only the committed
   synthetic JSON fixtures from
   `docs/rag/compass-chat-ui-state-contract-fixtures.json`.
4. Render desktop right-panel and mobile compact-panel states without login,
   chat submission, API calls, live RAG retrieval, database access, or env reads.

The renderer should be treated as a visual review aid for already-validated
fixtures, not as a new source of fixture truth.

## Architecture

### Component Extraction

Extract the inline `SourceStatePanel` from:

```text
src/app/chat-ollama/page.tsx
```

Recommended target:

```text
src/components/chat/SourceStatePanel.tsx
```

The extracted component should accept explicit props only:

- `state`
- `sources`
- `compact`
- `userQuestion`
- `showContactOption`
- no-op or injected handlers for contact, retry, source open, and expand

The component must not import route state, auth helpers, API clients, RAG
services, Supabase clients, env values, cookies, headers, local storage, or
session storage.

Recommended supporting type location, if needed:

```text
src/components/chat/chatUiStateTypes.ts
```

The production route should continue deriving `latestPanelState` exactly from
the latest assistant message and pass already-sanitized props into the extracted
component. The future implementation gate should avoid unrelated chat route
refactors.

### Fixture Source

The renderer must consume the committed synthetic fixture file:

```text
docs/rag/compass-chat-ui-state-contract-fixtures.json
```

Fixture use requirements:

- import or read the committed file only at build/dev time
- filter to `contract.syntheticOnly === true`
- reject fixtures where any execution flag is not false:
  - `productionApiCalled`
  - `ragSearchExecuted`
  - `browserUsed`
  - `dbTouched`
- render only `fixtures[]` payloads from the committed JSON
- do not create, mutate, or fetch fixture data at runtime
- do not use production screenshots or production conversation history as input

### Rendering Surface Choices

Two implementation options are acceptable for a future code gate.

Option A: dev-only route

```text
src/app/dev/chat-ui-state-fixtures/page.tsx
```

Required guardrails:

- compile or render only in local development
- return `notFound()` or a hard disabled state outside development
- no links from production navigation
- no auth dependency
- no prompt input
- no network calls
- fixture picker and viewport labels only

Option B: component-render harness

Possible future locations:

```text
src/components/chat/__fixtures__/ChatUiStateFixtureHarness.tsx
scripts/render-chat-ui-state-fixtures.mjs
```

Required guardrails:

- mount the extracted component directly with fixture props
- keep the harness independent of Next route auth and route handlers
- use static component rendering or local-only browser tooling only when a
  separate screenshot gate explicitly approves browser use
- no dependency on Storybook unless a separate dependency gate approves it

Preferred first implementation: Option A if reviewers need fast manual visual
inspection in the existing Next app shell. Prefer Option B if reviewers want a
more isolated render target and can approve the additional harness wiring.

## Fixture State Coverage

The future renderer must show every current fixture state from:

```text
docs/rag/compass-chat-ui-state-contract-fixtures.json
```

Desktop states:

- `initial-empty`
- `source-found` with three sources
- `source-found` with long Korean title wrapping
- `noData`
- `generation-limited`
- `error`

Mobile and small-mobile states:

- `mobile source-found` compact panel
- `mobile noData` compact panel
- `small-mobile generation-limited` compact panel
- `mobile error` no panel trap

Expected viewport labels:

- `desktop-lg`: `1440x900`
- `tablet`: `768x1024`
- `mobile`: `390x844`
- `small-mobile`: `360x740`

The renderer should make it obvious whether the fixture expects a desktop
right-panel surface or a mobile compact-panel surface. It should not infer state
from browser width alone; the fixture `panelExpectation.surface` should remain
the primary contract input.

## UI Review Expectations

The future renderer should support review of:

- source count and source-card visibility
- long Korean title and excerpt wrapping
- source toggle and expand/collapse controls
- noData copy distinct from error and generation-limited states
- generation-limited state preserving retrieved sources
- error state without invented evidence
- compact mobile panel inside the chat scroll area
- mobile panel not covering the input bar
- absence of horizontal page scroll in compact states
- absence of forbidden internal/provider/security text

The renderer may display fixture id, state, viewport label, and expected panel
surface for reviewer orientation. It must not expose raw implementation fields,
provider payloads, secrets, env names, cookies, tokens, stack traces, or API
paths in the rendered user-facing review surface.

## Security Boundaries

The future implementation must not:

- require login or read an authenticated session
- call `/api/chat-ollama` or any Compass API route
- execute live RAG search
- read or write the database
- run embeddings, reembedding, crawler, import, or migration code
- read `.env*`, process secrets, cookies, local storage, session storage, or
  browser credentials
- submit prompts
- use production traffic, production screenshots, or production conversation
  history
- add production navigation links to the harness
- make the harness available in production without a separate explicit approval
- mutate fixture files during render

Any future screenshot or browser automation gate must be separate and explicit.
This plan only approves designing a local renderer around committed fixtures.

## Validation Commands

Required validation for this docs-only planning gate:

```powershell
git diff --check
npm run verify:harness
npm run type-check
```

Required validation for a future code implementation gate:

```powershell
git diff --check
npm run verify:harness
npm run type-check
npm run build
```

If a future route-based harness is implemented, add one local manual review
step after the dev server starts. Browser automation and screenshots should
remain out of scope unless that later gate explicitly allows them.

## Implementation Gate Checklist

A future implementation gate should be limited to:

- extracting `SourceStatePanel` to a non-route component
- preserving current production route behavior
- adding one local-only renderer surface
- consuming the committed JSON fixture file
- documenting how to run the renderer locally
- validating with offline harness and TypeScript checks

The future gate should not bundle unrelated UI refreshes, chat behavior changes,
source ranking changes, auth changes, fixture schema changes, package dependency
additions, or production deployment work.

## No-Touch Confirmation

This document does not implement code and does not modify:

- `src/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `docs/rag/`
- API routes
- RAG services
- database/schema/migration/import/crawler/embedding paths
- env or secret files

The only intended artifact for this gate is:

```text
docs/tasks/2026-05-11_compass_chat_ui_state_contract_7_fixture_harness_implementation_plan_v1.md
```
