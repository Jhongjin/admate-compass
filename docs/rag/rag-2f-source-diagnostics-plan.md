# RAG-2F Source Diagnostics / Multi-vendor Rescue

Date: 2026-05-05

## Goal

RAG-2F makes Compass RAG easier to diagnose and reduces the Meta seed vector bias for explicit Kakao, Naver, and Google questions.

It does not change DB schema, embeddings, imported data, production env, or fixture expectations.

## Diagnostic Output

`scripts/evaluate-rag-fixtures.mjs` supports:

```bash
npm run evaluate:rag-fixtures -- --run --diagnostics
```

The diagnostic payload is printed as JSON and includes:

- fixture id and question
- expected vendor
- detected query intent
- fixture ambiguity flag
- response summary
- final source diagnostics
- fixture validation failures

Final source diagnostics include:

- `sourceVendor`
- `vendorMatch`
- `vendorMismatch`
- `lexicalOverlap`
- `hybridScore`
- `vectorScore`
- `keywordScore`
- `corpus`
- `evidenceType`
- `retrievalMethod`
- `rankReason`
- `sourceQuality`
- `originalTitle`

Rejected candidates are not exposed in production API responses.

## Multi-vendor Rescue

When the query explicitly targets Kakao, Naver, or Google, Compass reserves a rescue path for matching `document_chunks` candidates.

The rescue candidate must satisfy:

- `corpus = document_chunks`
- `sourceVendor = queryVendor`
- `lexicalOverlap >= 0.18`
- `keywordScore >= 0.35`
- `hybridScore >= 0.35`
- has excerpt
- not fallback/mock
- title or content contains a vendor/platform product term

If such a source exists and would otherwise be excluded from the final list, it can replace the weakest selected source.

## Meta-only Reject

For explicit Kakao, Naver, or Google questions, Meta-only vector seed sources are rejected when:

- `corpus = ollama_document_chunks`
- `sourceVendor = META`
- `vendorMismatch = true`
- `vendorMatch = false`
- target-vendor `document_chunks` rescue candidate exists
- `lexicalOverlap < 0.45`
- `keywordScore < 0.5`

This rule does not apply to generic/ANY vendor questions or Meta questions.

## Source Title Normalization

Response sources preserve `originalTitle` and normalize display `title` only:

- Kakao family: `카카오 광고 심사 가이드`
- Naver family: `네이버 광고 가이드`
- Google/YouTube family: `Google Ads 가이드`
- Meta/Facebook/Instagram: existing title, or `Meta 광고 정책` when missing

The DB values are not changed.

## Fixture Ambiguity

Diagnostics mark `fixtureAmbiguity=true` when:

- fixture `expectedVendor` is a concrete vendor, and
- the question does not explicitly mention that vendor.

This separates retrieval failures from fixture design issues.

