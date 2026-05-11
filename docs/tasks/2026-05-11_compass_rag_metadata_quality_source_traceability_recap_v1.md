# Compass RAG Metadata Quality Source Traceability Recap v1

Date: 2026-05-11
Status: docs-only recap
Scope: offline RAG/source traceability, metadata quality, noData/source
preservation lessons, and future safe validation candidates

## Purpose

This recap consolidates the current Compass RAG expectations for source
traceability and source metadata quality after the source-evidence and metadata
quality gates. It is documentation only.

This file does not change RAG retrieval, `/api/chat-ollama`,
`RAGSearchService`, fixtures, database state, embeddings, reembedding, crawler
jobs, imports, environment configuration, or production behavior.

## Current Source Traceability Expectations

Source-bearing responses should preserve enough evidence for a user or offline
checker to understand why the answer is grounded.

Current expectations:

- valid policy answers keep structured `sources`
- noData answers hide irrelevant or generic sources unless the fixture
  explicitly expects retained verified evidence
- generation-limited answers may still keep verified sources when the fixture
  allows it
- each source has stable display evidence such as `id`, `title`, and `excerpt`
- retrieval metadata such as `retrievalMethod` and `sourceQuality` remains
  available to the local checker
- confidence and score-like fields remain bounded when present
- user-facing copy must not expose internal implementation names

The offline harness is the preferred validation path for this contract. It can
verify source presence, noData source policy, source quality shape, and fixture
copy expectations without calling production APIs or live RAG retrieval.

## Current Metadata Quality Checks

The local source-quality checker has moved beyond source existence and now
checks a minimal display metadata contract for source-bearing sample responses.

Current metadata checks include:

- source-bearing fixture sources include `url` or `sourceReference`
- `sourceType` is present and allowlisted
- `vendorScope` is present and allowlisted
- fixture-level expected vendor scope can be asserted
- duplicate source title count can be capped
- internal implementation names are blocked from user-facing message, title,
  excerpt, source label, and source type text
- internal fields such as document/chunk identifiers may exist in fixture data
  only when they do not leak as display labels

Allowed source-type values are intentionally display-oriented, for example:

- `policy-note`
- `platform-policy`
- `approved-reference`
- `analyst-note`
- `benchmark-note`
- `uploaded-reference`
- `unknown-reviewed-source`

Metadata that should stay internal-only:

- raw DB table names
- raw corpus/import job identifiers
- raw chunk, embedding, vector, or provider identifiers
- raw provider payload fields
- tenant, account, advertiser, campaign, creative, cookie, token, secret, or
  signed URL values

## noData And Source Preservation Lessons

The noData boundary is not simply "hide all sources." The expected source
policy depends on why the answer is unavailable.

Observed fixture lessons:

- clearly valid policy questions should retain verified sources
- generic valid policy questions should retain sources while avoiding claims
  that one vendor proves every platform rule
- fictional products on real platforms can retain real platform policy sources
  while clearly stating that no product-specific policy was found
- fictional platforms should return noData and hide generic sources
- far-future or impossible policy targets should return noData and hide generic
  sources
- out-of-scope weather or recipe questions should return noData and hide
  sources
- generation-limited states should not drop verified source evidence when the
  fixture explicitly expects source preservation

User-facing noData copy should point the user back to real platform or policy
scope without exposing implementation details such as `retrievalMethod`,
`sourceQuality`, raw table names, embeddings, hybrid scores, or service names.

## Source Preservation Lessons

Source preservation is useful only when the preserved source still matches the
answer scope.

Practical lessons:

- keep sources for grounded policy answers, even when answer generation is
  limited
- do not use generic or unrelated sources to make an unsupported target appear
  grounded
- distinguish real-platform policy grounding from fictional-product
  speculation
- keep vendor scope explicit enough for future UI and checker validation
- use display-safe source labels rather than raw corpus or implementation names
- keep document and chunk identifiers available to diagnostics only when needed

## Future Safe Validation Candidates

Safe next validation candidates should remain local, offline, and non-mutating.

Recommended candidates:

- rerun `npm run check:rag-source-quality:sample` after any fixture metadata
  edits
- rerun `npm run check:nodata-boundary` after noData copy or source policy
  expectation edits
- rerun `npm run verify:harness` for broader offline regression coverage
- add docs-only recap entries after significant source traceability gates
- add additional sanitized fixtures for Google/YouTube, Naver, Kakao, generic
  policy, and multi-platform Korean questions
- extend local checker coverage only in separate test-only gates
- audit duplicate titles and vendor scope consistency in sanitized fixtures
- audit source labels for internal-name leakage before any UI display changes

Candidates that require separate explicit approval:

- production `/api/chat-ollama` calls
- live RAG retrieval or production source-preservation smoke tests
- authenticated UI/API QA
- `RAGSearchService` behavior changes
- DB reads or mutations
- SQL/schema work
- import, crawler, embedding, or reembedding execution
- environment, secret, credential, cookie, token, or signed URL inspection

## Suggested Future Acceptance Criteria

Future local-only validation gates can use these acceptance criteria:

- source-bearing fixtures have at least one display-safe source
- each source has a safe title, excerpt, reference, source type, and vendor
  scope
- expected vendor scope matches the answer and source metadata
- duplicate source titles stay within the fixture allowance
- noData fixtures preserve or hide sources according to the fixture's
  `sourcePolicy`
- user-facing copy contains no internal implementation identifiers
- verification commands run without production traffic or data mutation

## Verification Plan

For this docs-only recap:

```text
git diff --check -- docs/tasks/2026-05-11_compass_rag_metadata_quality_source_traceability_recap_v1.md
npm run check:secrets
```

If `npm run check:secrets` is unavailable, run a focused secret-like scan
against this new document only.

## No-Touch Confirmation

This docs-only recap does not perform:

- production API calls
- live RAG evaluation
- `/api/chat-ollama` edits
- `RAGSearchService` edits
- DB/schema reads or writes
- import, crawler, embedding, or reembedding execution
- fixture mutation
- environment variable changes
- package or lockfile changes
- product code changes
- secret, token, cookie, session, credential, signed URL, or raw provider output

## Result

Result: RECAP READY

The current safe path is to keep source traceability and metadata validation in
offline harnesses first, then request separate approval for any live,
production, DB, crawler, reembedding, or code-level follow-up.
