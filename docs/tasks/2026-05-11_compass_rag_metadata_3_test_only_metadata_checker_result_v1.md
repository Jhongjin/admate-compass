# Compass RAG Metadata 3 Test-only Metadata Checker Result v1

Date: 2026-05-11
Gate: Compass-RAG-Metadata-3
Status: completed
Repo: admate-compass

## Purpose

Tighten the local source-quality fixture checker so source-bearing Compass RAG
sample responses must include useful display metadata, without changing live
RAG behavior or production API contracts.

## Changed Files

```text
scripts/check-rag-source-quality.mjs
docs/rag/rag-source-quality-sample-response.json
```

## Implementation Summary

- Required each source-bearing fixture source to include `url` or
  `sourceReference`.
- Required allowlisted `sourceType` values.
- Required allowlisted `vendorScope` values.
- Added fixture-level expected vendor scope and duplicate-title limit support.
- Added user-facing copy checks for internal implementation names.
- Updated the local sample response with Meta-scoped display metadata.

The checker still allows internal score and quality fields inside fixture data,
but blocks those names from user-facing message, title, excerpt, source label,
and source type text.

## Verification

Passed:

```text
npm run check:rag-source-quality:sample
npm run verify:harness
npm run type-check
npm run build
git diff --check
```

`next-env.d.ts` changed during `next build` because of generated Next.js type
references. It was restored because this gate does not require a generated file
update.

## No-Touch Confirmation

This gate did not perform:

- production API calls
- live RAG evaluation
- `/api/chat-ollama` changes
- RAGSearchService changes
- SQL execution
- DB/schema changes
- import, crawler, or reembedding execution
- environment variable changes
- package or lockfile changes
- UI changes
- secret, token, cookie, session, credential, signed URL, or raw provider output
