# Compass RAG Source Evidence 1 Offline Matrix Audit v1

Date: 2026-05-10
Status: pass
Scope: offline RAG source/noData evidence matrix audit

## Verdict

Compass RAG source/noData boundary is stable in the current offline contract
checks.

No production queries, DB reads, imports, crawler runs, or reembedding jobs were
executed in this Gate.

## Current Standing Task

`.ai/TASKS.md` lists:

```text
Keep RAG source traceability stable.
Validate indexing/search contract after RAG changes.
```

This audit records the current deterministic baseline after the noDataFound
boundary work.

## Offline Contract Result

Command:

```text
npm run check:nodata-boundary
```

Result summary:

```json
{
  "ok": true,
  "fixtureCount": 8,
  "noDataFoundTrue": 4,
  "noDataFoundFalse": 4,
  "sourcePreservationCases": 4,
  "generationLimitedSourcePreservationCases": 4,
  "currentProductionBaseline": {
    "expected-pass": 8
  },
  "intentBoundaryHelperChecked": true,
  "ragSearchExecuted": false,
  "productionApiCalled": false
}
```

## Source Quality Checker

Command:

```text
npm run check:rag-source-quality
```

Result:

```text
skipped (provide response JSON path as argv or RAG_RESPONSE_FILE)
```

Interpretation:

- The checker is a response-file validator.
- It does not execute RAG retrieval by itself.
- It remains available for future captured response fixtures.

## Matrix

| Case group | Expected noDataFound | Source behavior |
| --- | --- | --- |
| valid Meta policy query | false | preserve verified sources |
| generic valid policy query | false | preserve verified sources |
| fictional product on real platform | false | preserve real-platform sources |
| Korean long-form ambiguous policy query | false | preserve verified sources |
| future/impossible policy target | true | sources hidden |
| fictional platform target | true | unrelated sources hidden |
| weather out-of-scope | true | sources hidden |
| recipe out-of-scope | true | sources hidden |

Generation-limited valid retrieval must continue preserving verified sources.

## No-Touch Confirmation

This Gate did not perform:

- production API calls
- authenticated UI QA
- RAG retrieval execution
- embedding/reembedding
- crawler/import
- DB/schema changes
- `/api/chat-ollama` changes
- `RAGSearchService` changes
- source/evidence UI changes
- secret/env/token/cookie/session output

No raw provider response or sensitive value was recorded.

## Verification

Passed:

```text
npm run check:nodata-boundary
```

Informational:

```text
npm run check:rag-source-quality
```

Skipped because no response JSON fixture was provided.

Required document check:

```text
git diff --check -- docs/tasks/2026-05-10_compass_rag_source_evidence_1_offline_matrix_audit_v1.md
```

## Next Gate

`Compass-RAG-Source-Evidence-2 Response Fixture Plan`

Plan sanitized response JSON fixtures for `check:rag-source-quality` without
calling production APIs or exposing raw provider payloads.
