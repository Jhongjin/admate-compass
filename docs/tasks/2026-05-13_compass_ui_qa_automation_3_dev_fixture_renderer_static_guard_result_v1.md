# Compass UI QA Automation 3 Dev Fixture Renderer Static Guard Result v1

Date: 2026-05-13 KST
Status: implemented / local static checker
Repo: admate-compass

## Purpose

Add a local static guard for the development-only chat UI fixture renderer so
prompt-bound fixtures cannot silently regress to a generic prompt bubble.

This follows the prompt-visible evidence harness and local fixture prompt
binding work. It is not authenticated QA and does not use a browser session.

## Changes

Changed files:

- `scripts/check-compass-dev-fixture-renderer-prompt-binding.mjs`
- `package.json`
- `docs/tasks/2026-05-13_compass_ui_qa_automation_3_dev_fixture_renderer_static_guard_result_v1.md`

Implementation summary:

- Added a static checker for `src/app/dev/chat-ui-state-fixtures/page.tsx`.
- The checker requires the renderer to stay development-only.
- The checker rejects the old generic `Fixture review question` prompt.
- The checker requires fixture-specific
  `fixture.promptExpectation?.userPrompt` rendering and `SourceStatePanel`
  binding.
- The checker validates the committed fixture contract still has prompt-bound
  conversational fixtures and a prompt-free initial empty state.
- Wired the checker into `verify:harness`.

## Safety Boundary

Not performed:

- browser-authenticated QA
- production API calls or valid production prompts
- login, session, cookie, token, or browser storage inspection
- RAG search execution
- DB/schema/crawler/reembedding mutation
- raw source/provider payload inspection
- secret or environment value output
- stage, commit, or push

## Verification

Completed local verification:

- PASS `npm run check:compass-dev-fixture-renderer`
- PASS `npm run check:compass-chat-ui-state-contract`
- PASS `npm run check:compass-qa-evidence-prompt-visible`
- PASS `npm run verify:harness`
- PASS `npm run type-check` after `next build` regenerated `.next/types`
- PASS `npm run build`
- PASS `git diff --check -- scripts/check-compass-dev-fixture-renderer-prompt-binding.mjs package.json docs/tasks/2026-05-13_compass_ui_qa_automation_3_dev_fixture_renderer_static_guard_result_v1.md`
- PASS `git diff --cached --name-only` returned no staged files

Note: `next build` auto-updated `next-env.d.ts`; it was restored to the
pre-existing tracked content because it is outside this queue's write scope.

## Blockers

None for local/static checker coverage.

Authenticated production Compass QA remains human/remote-debug gated even if a
human is logged into a normal browser.
