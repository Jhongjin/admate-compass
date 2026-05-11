# Compass Chat UI State Contract 9 Source Panel Visual Design QA Plan v1

Date: 2026-05-12
Status: docs-only visual/design QA plan
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`
Preceded by:

- `dcc5215a8 feat: add Compass chat fixture renderer`
- `77a84c61a docs: verify Compass fixture renderer safety`
- `docs/tasks/2026-05-12_compass_chat_ui_state_contract_8_fixture_renderer_post_deploy_safety_result_v1.md`

## Purpose

Define the next safe Compass design QA gate for chat source panel states using
the development-only fixture renderer.

This gate is for local visual/design review of already-committed synthetic
fixtures. It does not authorize login, production prompt submission,
production API calls, live RAG retrieval, database access, environment reads,
fixture mutation, source code edits, or production deployment work.

## Current Fixture Renderer Baseline

The approved renderer exists at:

```text
src/app/dev/chat-ui-state-fixtures/page.tsx
```

It renders only in development:

```text
if (process.env.NODE_ENV !== "development") {
  notFound();
}
```

It reads the committed synthetic fixture file:

```text
docs/rag/compass-chat-ui-state-contract-fixtures.json
```

It refuses to render unless the fixture contract confirms:

- `syntheticOnly === true`
- `productionApiCalled === false`
- `ragSearchExecuted === false`
- `browserUsed === false`
- `dbTouched === false`

The production boundary was verified in the preceding safety result:
production `/dev/chat-ui-state-fixtures` returned `404`, and unauthenticated
production `/chat-ollama` redirected to login before exposing chat UI.

## Gate Boundary

Allowed in this next gate:

- review this docs-only plan
- run local static/offline validation commands that do not read `.env*`
- use the committed synthetic fixture renderer as the intended visual surface
- if a local renderer is already running from an explicitly approved safe
  session, inspect only `http://localhost:<port>/dev/chat-ui-state-fixtures`
- capture sanitized observations about visible layout, labels, wrapping,
  controls, and overflow

Not allowed in this next gate:

- login or use an authenticated browser session
- submit prompts in production or locally
- call `/api/chat-ollama` directly or indirectly
- run production fixture execution
- run live RAG search, generation, embeddings, reembedding, crawler, import, or
  ranking work
- read or print `.env*`, secrets, cookies, tokens, local storage, session
  storage, provider payloads, or signed URLs
- read or write the database
- edit `src/`, `scripts/`, `package.json`, `package-lock.json`, fixture JSON,
  SQL, assets, runtime config, or env files
- add browser automation that inspects credentials, storage, network payloads,
  or production pages

## Local Browser Smoke Availability

Local browser verification is optional and only safe when a renderer is already
available under a known local-only development session that has been approved
for this purpose.

Do not start a fresh `npm run dev`, `npm run build`, or `npm run start` for
this no-env-read gate unless a separate approval explicitly accepts that Next
may load local `.env*` files during startup/build.

If no approved local renderer is already running, record browser visual smoke
as planned, not executed. The offline fixture contract remains the source of
truth for state coverage.

## Visual Coverage Matrix

Review every fixture currently present in
`docs/rag/compass-chat-ui-state-contract-fixtures.json`.

| Fixture | Viewport | Surface | Required design check |
| --- | --- | --- | --- |
| `chat-ui-initial-empty-source-panel` | `desktop-lg` / `1440x900` | right panel | Empty source state is calm, centered, and does not imply evidence. |
| `chat-ui-source-found-three-sources` | `desktop-lg` / `1440x900` | right panel | Count, source cards, open controls, and excerpts scan cleanly. |
| `chat-ui-source-found-long-korean-title` | `desktop-lg` / `1440x900` | right panel | Long Korean title wraps without horizontal overflow or card breakage. |
| `chat-ui-nodata-empty-source-panel` | `desktop-lg` / `1440x900` | right panel | No-data guidance is distinct from source-found and avoids approval language. |
| `chat-ui-generation-limited-sources-preserved` | `desktop-lg` / `1440x900` | right panel | Limitation state preserves inspected sources without looking like an error. |
| `chat-ui-error-no-sources` | `desktop-lg` / `1440x900` | right panel | Error state exposes recovery without inventing evidence. |
| `chat-ui-mobile-source-found-compact-panel` | `mobile` / `390x844` | compact panel | Source panel sits below the message and keeps controls finger-target sized. |
| `chat-ui-mobile-nodata-compact-panel` | `mobile` / `390x844` | compact panel | No-data copy remains readable and does not create a dead-end overlay. |
| `chat-ui-mobile-generation-limited-compact-panel` | `small-mobile` / `360x740` | compact panel | Badges, source count, title, and button wrap on the small mobile width. |
| `chat-ui-mobile-error-no-panel-trap` | `mobile` / `390x844` | compact panel | Error panel does not cover the composer or trap recovery controls. |

## Desktop Review Checklist

For desktop fixture rows:

- source panel width remains bounded and readable
- no horizontal page overflow
- card title/excerpt wrapping is stable for Korean text
- heading matches state:
  - `근거 문서`
  - `근거 문서 없음`
  - `생성 답변 제한`
- source count badge matches fixture source count
- open/download and expand/collapse icon buttons remain visible and aligned
- collapsed and expanded cards do not resize neighboring layout unexpectedly
- `noData` and `error` do not show empty source-card shells
- `generation-limited` presents as a constrained answer state, not a fatal
  error state

## Mobile Review Checklist

For mobile and small-mobile fixture rows:

- compact source panel is inside the chat content flow
- desktop right-panel surface is not represented as a visible mobile column
- no fixed overlay covers the composer
- no horizontal page overflow at `390x844` or `360x740`
- long Korean titles, badges, and buttons wrap within the viewport
- source toggle and expand controls remain practical touch targets
- `noData` and `error` remain visually distinct
- `generation-limited` keeps source inspection available
- fixture viewport frame itself does not mask overflow problems

## Forbidden User-Facing Text

The visual review must confirm that the renderer surface does not expose:

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

Also confirm unsupported states do not use approval-like wording:

```text
verified source
accepted
allowed
safe
no issue
```

Those terms must not appear in `initial-empty`, `noData`, or `error` visual
states.

## Proposed Execution Sequence

1. Confirm local `HEAD` includes `dcc5215a8` and `77a84c61a`.
2. Confirm the worktree is clean or record unrelated existing changes before
   starting.
3. Run `npm run verify:harness` to validate the committed offline fixtures.
4. Run `npm run type-check` to confirm the renderer/component typings still
   compile.
5. Skip `npm run build` for this no-env-read gate unless separately approved,
   because Next build may load `.env*` and broader app surfaces.
6. If and only if an approved local renderer is already running, open the dev
   fixture URL locally and perform the visual checklist above.
7. If no approved renderer is already running, record visual smoke as planned
   and hand this document to the next operator as the safe execution script.
8. Stop before login, prompt submission, API calls, production browsing,
   fixture changes, or code changes.

## Pass Criteria

This gate passes when:

- the docs-only boundary is preserved
- offline fixture harness passes
- TypeScript passes
- build is either explicitly approved and passes, or is skipped with the
  no-env-read reason recorded
- every fixture has a desktop/mobile visual review status or a clear
  "planned, not executed" status
- no forbidden internal/security/provider text appears in reviewed UI
- no production/auth/API/RAG/DB/env surface is touched

## Validation For This Docs Task

Safe validation for this plan:

```powershell
git diff --check -- docs/tasks/2026-05-12_compass_chat_ui_state_contract_9_source_panel_visual_design_qa_plan_v1.md
npm run verify:harness
npm run type-check
```

Validation intentionally skipped unless separately approved:

```powershell
npm run build
```

Reason: this gate explicitly avoids env reads and production-adjacent runtime
expansion.

## No-Touch Confirmation

This plan does not modify:

- `src/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `docs/rag/`
- API routes
- RAG services
- database/schema/migration/import/crawler/embedding paths
- env or secret files

The only intended changed artifact for this gate is:

```text
docs/tasks/2026-05-12_compass_chat_ui_state_contract_9_source_panel_visual_design_qa_plan_v1.md
```

During drafting, leave the file unstaged until commander review confirms the
docs-only scope.
