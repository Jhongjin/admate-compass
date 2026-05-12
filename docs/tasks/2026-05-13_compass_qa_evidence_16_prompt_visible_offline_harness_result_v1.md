# Compass QA Evidence 16 Prompt-Visible Offline Harness Result v1

Date: 2026-05-13 KST
Status: implemented / local static checker
Repo: admate-compass

## Purpose

Add a non-human-gated evidence contract so future Compass UI QA records cannot
mark source panel or noData captures as pass/fail unless the submitted prompt is
visible in the same sanitized evidence context.

This follows the NoData-9 finding that prompt-hidden UI evidence is
inconclusive even when the backend shape later passes.

## Implementation

Changed files:

- `docs/rag/compass-qa-evidence-prompt-visible-fixtures.json`
- `scripts/check-compass-qa-evidence-prompt-visible.mjs`
- `package.json`
- `docs/tasks/2026-05-13_compass_qa_evidence_16_prompt_visible_offline_harness_result_v1.md`

The new checker validates offline/static records for:

- fixture id
- expected UI state
- prompt-visible assertion
- result-linked-to-prompt assertion
- terminal state visible assertion
- pass/fail evidence requiring `promptVisible=true`
- prompt-hidden evidence being recorded only as `blocked`
- optional sanitized response shape
- no forbidden secret/session/raw payload/fingerprint/source hash text in display
  evidence fields

The checker is wired into `verify:harness` as:

```text
npm run check:compass-qa-evidence-prompt-visible
```

## Safety Boundary

Not performed:

- production API calls
- browser login, browser automation, cookies, tokens, or sessions
- RAG search execution
- `/api/chat-ollama`, RAGSearchService, DB, schema, crawler, import, embedding,
  or reembedding changes
- secret, env, raw provider payload, raw source payload, source hash, or
  fingerprint inspection
- stage, commit, or push

## Verification

Completed local verification:

- `npm run check:nodata-boundary`
- `npm run check:compass-chat-ui-state-contract`
- `npm run check:compass-qa-evidence-prompt-visible`
- `npm run verify:harness`
- `npm run build`
- `npm run type-check`
- `git diff --check -- docs/rag/compass-qa-evidence-prompt-visible-fixtures.json scripts/check-compass-qa-evidence-prompt-visible.mjs package.json docs/tasks/2026-05-13_compass_qa_evidence_16_prompt_visible_offline_harness_result_v1.md`
- trailing-whitespace/final-newline check for the three untracked new files
- `git diff --cached --name-only`

Note: an initial parallel `type-check` run started before `build` finished
creating `.next/types` and failed on missing generated Next type files. After
`build` completed, `npm run type-check` was rerun by itself and passed.

## Blockers

None for the offline/static evidence contract.

Authenticated production UI QA remains human-gated and should use this contract
only as a record-quality requirement, not as approval to log in, submit prompts,
or call production APIs.
