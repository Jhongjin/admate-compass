# Compass UI QA Automation 2 Local Fixture Prompt Binding Result v1

Date: 2026-05-13 KST
Status: implemented / local static fixture renderer
Repo: admate-compass

## Purpose

Bind each conversational Compass chat UI state fixture to a visible synthetic
user prompt so future local visual QA cannot rely on a generic prompt bubble.

This follows the prompt-visible evidence contract and stays local/static only.

## Changes

Changed files:

- `docs/rag/compass-chat-ui-state-contract-fixtures.json`
- `scripts/check-compass-chat-ui-state-contract-fixtures.mjs`
- `src/app/dev/chat-ui-state-fixtures/page.tsx`
- `docs/tasks/2026-05-13_compass_ui_qa_automation_2_local_fixture_prompt_binding_result_v1.md`

Implementation summary:

- Added `promptExpectation.userPrompt`, `promptVisible`, and
  `resultLinkedToPrompt` to all conversational fixtures.
- Kept the initial empty fixture prompt-free.
- Updated the static contract checker to require prompt binding for all
  non-initial states.
- Updated the development-only fixture renderer to display the fixture-specific
  user prompt and pass it to `SourceStatePanel`.

## Safety Boundary

Not performed:

- browser-authenticated QA
- production API calls
- prompt submission
- DB/schema/RAG/crawler/reembedding work
- session, cookie, token, source payload, provider payload, or secret
  inspection
- stage, commit, or push

## Verification

Completed local verification:

- `npm run check:compass-chat-ui-state-contract`
- `npm run check:compass-qa-evidence-prompt-visible`
- `npm run verify:harness`
- `npm run type-check`
- `npm run build`
- `git diff --check -- docs/rag/compass-chat-ui-state-contract-fixtures.json scripts/check-compass-chat-ui-state-contract-fixtures.mjs src/app/dev/chat-ui-state-fixtures/page.tsx docs/tasks/2026-05-13_compass_ui_qa_automation_2_local_fixture_prompt_binding_result_v1.md`
- `git diff --cached --name-only`

Note: `npm run build` rewrote `next-env.d.ts` as a generated Next file. That
out-of-scope generated change was restored to the HEAD content after build
verification.

## Blockers

None for local/static fixture prompt binding.

Authenticated production QA remains human-gated and should use this fixture
renderer only as local evidence preparation.
