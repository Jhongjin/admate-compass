# Compass RAG Metadata Quality Audit Plan v1

Date: 2026-05-11
Status: docs-only plan
Scope: source metadata quality after RAG-3O ranking context patch

## Purpose

The offline RAG harness is healthy after the RAG-3O ranking context patch, but
the current source-quality contract mostly verifies the existence and scoring
quality of sources. This plan defines a no-mutation follow-up for source
metadata quality, especially URL/vendor/source-type consistency.

This gate does not change code, fixtures, corpus data, DB schema, production
configuration, import jobs, crawler jobs, or reembedding jobs.

## Current Baseline

Current local checks:

- `npm run verify:harness` passes.
- `npm run build` passes.
- `npm run type-check` passes after `.next` types are current.
- `docs/rag/rag-source-quality-sample-response.json` passes the current source
  quality checker.

Current source-quality checker requires:

- response message
- sources array
- source `id`
- source `title`
- source `excerpt`
- bounded similarity/score fields when present
- `retrievalMethod`
- non-fallback evidence
- `sourceQuality`
- bounded `sourceQuality.qualityScore`
- confidence `0..100`

Current fixture evaluator already reads optional source fields such as:

- `url`
- `corpus`
- `sourceType`
- `documentId`
- `chunkId`

However, those fields are not yet a strict source-quality contract.

## Metadata Quality Risks

Risk areas to audit before strengthening the checker:

- source has a useful title/excerpt but no URL or source reference
- vendor implied by answer does not match vendor implied by source metadata
- generic-policy fixtures return one platform-specific source too strongly
- source type is missing or too implementation-specific for UI display
- document/chunk identifiers are useful internally but should not leak as user
  facing UI labels
- duplicate source titles hide weak corpus diversity
- fallback or low-quality sources pass because title/excerpt exists

## Proposed Fixture Categories

Audit at least these categories using local fixtures first:

- vendor-specific Meta policy query
- vendor-specific Google/YouTube query
- generic policy query across platforms
- out-of-scope noData query
- fictional platform noData query
- long Korean multi-platform query

For each fixture, record:

- expected vendor scope
- expected source type scope
- whether URL/reference is required
- whether source type can be user-visible
- whether document/chunk ids must stay internal
- whether duplicate title count is acceptable

## Contract Tightening Candidates

Candidate source fields for future checker tightening:

- `url` or approved source reference for source-bearing responses
- `sourceType` from an allowlist
- vendor marker from an allowlist when fixture expects a vendor-specific answer
- no raw internal table names in user-facing source labels
- duplicate-title maximum for source-bearing responses

Candidate fields that should remain internal-only:

- raw DB table names
- raw chunk ids
- raw corpus import job ids
- raw embeddings/vector ids
- raw provider response fields

## Recommended Next Gate

`Compass-RAG-Metadata-2 source metadata fixture contract plan`

Recommended scope:

- docs/rag fixture expectation update plan only
- no code change in first pass
- no import/reembedding/crawler
- no production API call
- no SQL execution

After that, a separate implementation gate may update the local checker and
fixture expectations.

## Verification Plan

For this docs-only gate:

```text
git diff --check -- docs/tasks/2026-05-11_compass_rag_metadata_quality_audit_plan_v1.md
npm run verify:harness
npm run type-check
npm run build
```

## No-Touch Confirmation

This gate did not perform:

- production API calls
- live RAG evaluation
- authenticated browser QA
- SQL execution
- DB mutation
- import, crawler, or reembedding execution
- fixture data changes
- environment variable changes
- product code changes
- secret, token, cookie, session, credential, signed URL, or raw provider output

## Result

Result: PLAN READY

The next safe step is a fixture contract plan before changing source metadata
checker behavior.
