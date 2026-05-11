# Compass RAG Metadata 2 Source Metadata Fixture Contract Plan v1

Date: 2026-05-11
Gate: Compass-RAG-Metadata-2
Status: docs-only plan
Scope: plan source metadata fixture contract tightening before checker or
fixture implementation.

## Purpose

The current Compass offline RAG harness verifies source presence and quality
signals, but the metadata contract is still loose for URL/reference,
vendor/platform scope, source type, and user-facing source labels.

This gate defines a fixture contract plan only. It does not modify fixtures,
checker code, RAG behavior, production APIs, corpus data, import jobs, crawler
jobs, reembedding jobs, SQL, or UI.

## Current Baseline

Current docs and fixtures reviewed:

- `docs/tasks/2026-05-11_compass_rag_metadata_quality_audit_plan_v1.md`
- `docs/rag/rag-source-quality-sample-response.json`
- `docs/rag/rag-nodata-boundary-fixtures.json`

Current source-quality checker requires source-bearing responses to have:

- source `id`
- source `title`
- source `excerpt`
- `retrievalMethod`
- non-fallback `sourceQuality`
- bounded score/quality fields when present
- confidence within range

Current noData boundary fixtures already protect against:

- future/impossible policy targets
- fictional platform targets
- out-of-scope weather/recipe requests
- generation-limited source preservation
- internal term leakage in user-facing copy expectations

## Contract Gap

The next contract should verify source metadata usefulness, not only source
existence.

Current gaps:

- source-bearing responses can pass without a URL or approved source reference
- vendor scope is implied by title/excerpt but not checked as structured
  metadata
- `sourceType` is optional and not yet allowlisted
- document/chunk identifiers may exist but are not clearly marked internal-only
- duplicate titles can hide weak source diversity
- generic policy answers may over-lean on one vendor source without an explicit
  scope rule

## Proposed Metadata Fields

Future source-bearing fixture contract should consider these fields:

| Field | Requirement candidate | Notes |
| --- | --- | --- |
| `url` or `sourceReference` | required for source-bearing responses unless explicitly waived | Use safe public URL, hostname, or approved reference label. |
| `vendorScope` | required for vendor-specific fixtures | Allow values such as `meta`, `google`, `naver`, `kakao`, `multi-platform`, `generic`. |
| `sourceType` | required after allowlist is defined | User-facing category should differ from raw implementation tables. |
| `sourceLabel` | recommended | Display-safe label derived from title/reference. |
| `freshnessLabel` | optional | Useful for UI but should not imply currentness when missing. |
| `documentId` / `chunkId` | internal-only | Allowed in fixture data, forbidden in customer-facing copy/snapshots. |

Do not require all fields in a single patch. The first implementation should
prefer a minimal enforceable subset.

## Source Type Allowlist Candidate

Candidate values:

- `policy-note`
- `platform-policy`
- `approved-reference`
- `analyst-note`
- `benchmark-note`
- `uploaded-reference`
- `unknown-reviewed-source`

Forbidden user-facing source type values:

- raw DB table names
- raw corpus names
- raw import job names
- raw embedding/vector identifiers
- raw provider response labels
- `ollama_document_chunks`
- `RAGSearchService`

## Fixture Category Expectations

| Fixture category | Metadata expectation | Strictness |
| --- | --- | --- |
| Vendor-specific Meta query | `vendorScope=meta`, URL/reference required, `sourceType` allowlisted | high |
| Vendor-specific Google/YouTube query | `vendorScope=google`, URL/reference required, `sourceType` allowlisted | high |
| Generic valid policy query | `vendorScope=generic` or `multi-platform`; sources may be mixed but labels must not imply universal proof | medium |
| Multi-platform Korean longform query | `vendorScope=multi-platform`; no single vendor should appear as full proof unless copy limits scope | medium |
| Fictional product on real platform | real platform source retained; product-specific validation must not be implied | medium |
| Future/impossible policy target | no sources; metadata requirement not applicable | high noData |
| Fictional platform target | no sources; metadata requirement not applicable | high noData |
| Out-of-scope query | no sources; metadata requirement not applicable | high noData |

## First Implementation Recommendation

The next implementation gate should stay local and test-only.

Recommended first checker changes:

- require `url` or `sourceReference` for source-bearing sample responses
- require allowlisted `sourceType`
- add fixture-level expected `vendorScope`
- assert no user-facing copy contains internal field names
- keep `documentId` and `chunkId` allowed only as internal fixture metadata
- cap duplicate title count for source-bearing responses

Recommended first fixture changes:

- update `docs/rag/rag-source-quality-sample-response.json`
- add metadata expectations to selected RAG/noData fixture records only if the
  checker reads them locally
- avoid changing production response contracts in the same gate

## Checker Behavior Candidate

Future local checker should fail if:

- a source-bearing response has neither `url` nor `sourceReference`
- `sourceType` is missing or outside the allowlist
- expected vendor scope is `meta` but source metadata implies another vendor
- internal-only names appear in user-facing source title or excerpt
- duplicate source titles exceed the configured fixture allowance
- fallback sources satisfy a source-bearing fixture without explicit allowance

Future checker should not require:

- production API calls
- live RAG evaluation
- import/crawler/reembedding
- DB reads
- raw provider payload inspection

## Redaction And UI Safety

The metadata fixture contract should protect user-facing UI from:

- raw table names
- raw corpus or import identifiers
- raw chunk IDs
- raw embedding/vector IDs
- token, cookie, credential, secret, signed URL, or env values
- raw provider responses
- private account, advertiser, campaign, creative, or tenant identifiers

If a source path or URL is needed, fixtures should use safe public examples or
approved reference labels.

## Verification Plan For Future Implementation

Required commands for the implementation gate:

```text
npm run verify:harness
npm run type-check
npm run build
git diff --check
```

If `next-env.d.ts` changes only because of generated Next build references,
restore it unless the implementation explicitly requires the update.

## Current Gate Verification

This docs-only gate should be verified with:

```text
git diff --check -- docs/tasks/2026-05-11_compass_rag_metadata_2_source_metadata_fixture_contract_plan_v1.md
npm run verify:harness
npm run type-check
npm run build
```

## No-Touch Confirmation

This gate does not perform:

- production API calls
- live RAG evaluation
- fixture data changes
- checker code changes
- product UI changes
- SQL execution
- DB mutation
- import, crawler, or reembedding execution
- environment variable changes
- package or lockfile changes
- secret, token, cookie, session, credential, signed URL, or raw provider output

## Next Gate

Recommended next gate:

```text
Compass-RAG-Metadata-3 test-only metadata checker implementation
```

Suggested scope:

```text
Update only local fixture/checker files to enforce the minimal source metadata
contract. Do not call production APIs, run live RAG, import data, crawl,
reembed, change DB/schema/env, or alter /api/chat-ollama behavior.
```
