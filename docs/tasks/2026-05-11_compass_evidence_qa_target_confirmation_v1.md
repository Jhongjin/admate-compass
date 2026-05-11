# Compass Evidence QA Target Confirmation v1

Date: 2026-05-11
Status: blocker / target confirmation required
Scope: local/offline Compass evidence QA implementation readiness

## Purpose

This note records why the current Compass evidence QA implementation target is
not yet clear enough for product repo fixture or checker edits.

The requested path is local/offline only. After reviewing the Compass RAG
source evidence docs and the Design Director handoff docs, the safe conclusion
is to pause before creating new fixtures, tests, helpers, or UI assertions until
the exact destination is approved.

## Reviewed Inputs

Compass repo:

- `docs/tasks/2026-05-10_compass_rag_source_evidence_5_offline_contract_recap_v1.md`
- `docs/tasks/2026-05-11_compass_rag_metadata_2_source_metadata_fixture_contract_plan_v1.md`
- `docs/tasks/2026-05-11_compass_rag_metadata_3_test_only_metadata_checker_result_v1.md`
- `docs/tasks/2026-05-11_compass_rag_metadata_quality_source_traceability_recap_v1.md`
- `scripts/check-rag-source-quality.mjs`
- `docs/rag/rag-source-quality-sample-response.json`
- `scripts/check-nodata-boundary-fixtures.mjs`
- `docs/rag/rag-nodata-boundary-fixtures.json`

Design Director handoff:

- `D:\Projects\AdMate\admate-design-director\docs\tasks\2026-05-10_design_director_compass_evidence_qa_1_state_matrix_v1.md`
- `D:\Projects\AdMate\admate-design-director\docs\tasks\2026-05-10_design_director_compass_evidence_qa_2_fixture_test_plan_v1.md`
- `D:\Projects\AdMate\admate-design-director\docs\tasks\2026-05-11_design_director_compass_evidence_qa_3_fixture_review_prep_v1.md`
- `D:\Projects\AdMate\admate-design-director\docs\tasks\2026-05-11_compass_evidence_qa_implementation_prep_v1.md`

## Current Implemented Offline Coverage

Compass already has local/offline checks for:

- source-bearing sample response quality
- URL or source reference presence
- allowlisted source type and vendor scope
- duplicate source title limits
- internal implementation name leakage in user-facing response/source text
- noData boundary fixture contracts
- generation-limited source preservation expectations
- default harness execution through `npm run verify:harness`

These checks do not call production APIs, run live RAG retrieval, mutate DB
state, crawl, import, reembed, change env, or alter `/api/chat-ollama` or
`RAGSearchService` behavior.

## Blocker

The Design Director implementation prep says the future product Agent must
obtain separate approval for:

- exact route name
- exact fixture path
- exact test path
- exact helper path, if needed
- expected changed file list
- reason each file belongs in scope

It also states that product repo files should not be created or modified until
that approval is granted.

The current Compass repo has multiple plausible local/offline destinations:

- extend `docs/rag/rag-source-quality-sample-response.json`
- add a new evidence QA fixture file under `docs/rag`
- extend `scripts/check-rag-source-quality.mjs`
- add a new checker under `scripts`
- add component-level source panel tests if a test runner is approved later

Because more than one target fits the request, implementation would risk
creating parallel fixture infrastructure or testing a UI surface that was not
approved for this gate.

## Proposed Target Confirmation

Before implementation, approve one of these local/offline target paths:

1. `docs/rag` fixture plus `scripts` checker only
   - Add a new synthetic evidence QA fixture file.
   - Add or extend a deterministic Node checker.
   - Wire it into `verify:harness` only if explicitly approved.

2. Existing RAG source-quality checker extension
   - Extend only `docs/rag/rag-source-quality-sample-response.json` and
     `scripts/check-rag-source-quality.mjs`.
   - Keep the scope to response/source metadata and redaction only.

3. UI/component fixture proposal only
   - Create a docs-only implementation proposal that names future component
     test paths after the UI owner confirms the target surface.
   - No product code or test creation in this gate.

Recommended safest next gate:

```text
Compass-Evidence-QA-Final-Destination-Approval
```

Required approval payload:

```text
route/surface:
fixture path:
checker/test path:
helper path, if any:
whether to wire into verify:harness:
allowed changed files:
validation commands:
```

## No-Touch Confirmation

This gate did not perform:

- production API calls
- live RAG evaluation
- authenticated browser QA
- `/api/chat-ollama` edits
- `RAGSearchService` edits
- DB/schema reads or writes
- import, crawler, embedding, or reembedding execution
- environment variable changes
- package or lockfile changes
- product UI changes
- fixture/checker/test implementation
- secret, token, cookie, session, credential, signed URL, raw provider output,
  private customer data, or raw source payload output

## Validation Plan

For this blocker note:

```text
git diff --check -- docs/tasks/2026-05-11_compass_evidence_qa_target_confirmation_v1.md
npm run verify:harness
```

