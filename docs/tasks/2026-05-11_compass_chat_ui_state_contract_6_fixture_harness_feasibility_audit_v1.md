# Compass Chat UI State Contract 6 Fixture Harness Feasibility Audit v1

Date: 2026-05-11
Status: docs-only feasibility audit
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`

## Goal

Gate whether Compass Chat UI State Contract fixtures already have a safe
non-production story/demo/fixture render harness that can be used for
source-panel, noData, generation-limited, error, and mobile compact-panel visual
review.

This audit is docs-only. It does not authorize production prompt submission,
login, browser automation, `/api/chat-ollama` calls, RAG execution, database
access, embedding or reembedding work, crawler/import work, env or secret
inspection, production route changes, API changes, or source edits.

## Summary Decision

No existing safe local story/demo/render harness was found for the chat UI state
contract fixtures.

The repo does have a safe deterministic fixture contract surface:

- `docs/rag/compass-chat-ui-state-contract-fixtures.json`
- `scripts/check-compass-chat-ui-state-contract-fixtures.mjs`
- `npm run check:compass-chat-ui-state-contract`
- `npm run verify:harness`

Those assets validate fixture schema and state expectations offline, but they do
not render React components, mount a local route, open a browser, or capture UI
pixels. Because the task requested docs-only unless an existing non-production
fixture surface already exists, no fixture/story harness was implemented.

## Inspected Surfaces

| Surface | Finding | Harness decision |
| --- | --- | --- |
| `package.json` | Contains offline checker scripts, including `check:compass-chat-ui-state-contract` and `verify:harness`; no Storybook, Playwright, Vitest, Jest, or render-harness script found. | Use offline contract checks only. |
| `docs/rag/compass-chat-ui-state-contract-fixtures.json` | Contains synthetic-only fixture payloads for `initial-empty`, `source-found`, `noData`, `generation-limited`, `error`, desktop, mobile, and small-mobile expectations. | Valid fixture source, not a renderer. |
| `scripts/check-compass-chat-ui-state-contract-fixtures.mjs` | Reads the committed JSON fixture and validates state coverage, forbidden internal text, source-panel expectations, mobile compact-panel constraints, and operational flags. | Safe local checker. |
| `scripts/evaluate-rag-fixtures.mjs` | Defaults to schema validation only; endpoint calls occur only with `--run`, which was not used. | Safe only without `--run`. |
| `src/app/chat-ollama/page.tsx` | Production authenticated route contains inline `SourceStatePanel` and derives UI state from latest assistant message. | Not safe as a fixture harness because it is production route code and auth/API-adjacent. |
| `src/components/chat/ChatBubble.tsx` | Renders assistant/user chat bubbles and inline source toggle/source cards when supplied sources. | Component exists, but no non-production story/demo harness found. |
| `src/components/chat/RelatedResources.tsx` | Renders source panel style cards, noData empty state, and generation-limited banners. | Component exists, but no non-production story/demo harness found. |
| `src/app/test-ollama`, `src/app/test-ollama-response`, `src/app/test-railway`, `src/app/api/ollama/local-test`, and other `test-*` routes | Test/demo-like routes exist, but they are route/API surfaces and not scoped to the committed chat UI state fixtures. | Do not use for this gate. |

## Existing Fixture Contract Details

The committed chat UI state fixture contract is synthetic-only and explicitly
records:

- `productionApiCalled: false`
- `ragSearchExecuted: false`
- `browserUsed: false`
- `dbTouched: false`

Fixture coverage includes:

- initial empty source panel
- source-found with three sources
- source-found with long Korean source title wrapping expectation
- noData with empty source panel
- generation-limited with sources preserved
- error with no invented evidence
- mobile source-found compact panel
- mobile noData compact panel
- small-mobile generation-limited compact panel
- mobile error no-panel-trap case

The checker validates:

- required state coverage
- required mobile variants for source-found, noData, generation-limited, and
  error
- source count and source-toggle consistency
- right-panel versus compact-panel expectations
- no exposure of internal/RAG/provider/secret-like text
- no production API, RAG, browser, or DB execution flags

## Story/Demo/Render Harness Search Result

No files matching common render harness patterns were found under `src`, `docs`,
or `scripts`:

- `*.stories.*`
- `*.story.*`
- `*.fixture.*`
- `*.fixtures.*`
- `*.spec.*`
- `*.test.*`

No Storybook configuration or package script was found. No safe local page was
found that consumes `docs/rag/compass-chat-ui-state-contract-fixtures.json` and
renders `ChatBubble`, `RelatedResources`, or the inline `SourceStatePanel`
without touching production routes/auth/API/RAG.

## How To Use The Existing Safe Surface

Use the current offline checker only:

```powershell
npm run check:compass-chat-ui-state-contract
```

For the full existing offline harness:

```powershell
npm run verify:harness
```

`npm run verify:harness` is safe for this gate because its current package
wiring runs local deterministic Node checkers and invokes
`scripts/evaluate-rag-fixtures.mjs` without `--run`. That means the evaluator
performs fixture-schema validation and does not call `/api/chat-ollama`.

Do not run:

```powershell
npm run smoke:chat-ollama-local
npm run smoke:compass-rag-contract
npm run gate6c:dry-run
npm run check:migration-env
npm run verify:migration
npm run evaluate:rag-fixtures -- --run
```

Those commands are outside this gate because they are chat API, RAG, DB/import,
schema, migration/env, or production-adjacent surfaces.

## Feasibility Assessment

| Option | Feasible now? | Risk | Recommendation |
| --- | --- | --- | --- |
| Use existing JSON fixture contract and checker | Yes | Low | Approved for offline validation. |
| Document an existing story/demo render harness | No | N/A | Blocked because no existing harness was found. |
| Add a tiny non-production route under `src/app` | Technically possible | Medium, because it touches app routing and could become a production surface. | Do not implement in this docs-only gate. |
| Add Storybook or a component test renderer | Technically possible | Medium/high due to dependency, package, and render setup changes. | Requires a separate implementation gate. |
| Extract `SourceStatePanel` from `chat-ollama/page.tsx` for fixture rendering | Useful future direction | Medium, because it touches production route/component structure. | Requires a separate scoped code gate. |

## Future Harness Requirements

A future approved harness should:

- live outside production navigation and production API paths
- consume only committed synthetic fixtures
- never call `/api/chat-ollama`
- never require login
- never read `.env*`, cookies, local storage, session storage, or tokens
- never touch RAG, DB, embeddings, crawler, import, or reembedding code
- render fixture states without submitting prompts
- make mobile compact-panel and desktop right-panel states reviewable
- keep fixture rendering disabled or inaccessible in production builds unless
  explicitly approved
- include a deterministic validation command that can run without browser if
  pixel review is not part of the gate

## Recommended Next Gate

If visual review is still needed, open a separate implementation gate with one
of these explicit scopes:

1. Extract a non-route, non-API `SourceStatePanel` component from
   `src/app/chat-ollama/page.tsx` and add a dev-only fixture renderer.
2. Add a minimal component-render harness that imports the committed JSON
   fixtures and renders `ChatBubble` plus the extracted source panel without
   auth, API calls, browser automation, RAG, DB, or env reads.
3. Add a separate screenshot/review gate only after the fixture renderer exists
   and the user explicitly approves browser use.

## Validation Plan

Allowed:

```powershell
git diff --check -- docs/tasks/2026-05-11_compass_chat_ui_state_contract_6_fixture_harness_feasibility_audit_v1.md
npm run verify:harness
npm run type-check
```

There is no `verify:harness/type-check` script in `package.json`; use the
existing `verify:harness` and `type-check` scripts separately.

## No-Touch Confirmation

This audit did not run login, production prompts, browser automation,
`/api/chat-ollama` calls, RAG execution, DB reads/writes, embedding,
reembedding, crawler/import work, env/secret inspection, or production route/API
changes.

The only intended changed artifact is:

```text
docs/tasks/2026-05-11_compass_chat_ui_state_contract_6_fixture_harness_feasibility_audit_v1.md
```
