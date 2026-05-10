# Compass RAG Source Evidence 3 Fixture Harness Integration Decision v1

Date: 2026-05-10
Status: decision
Scope: source-quality fixture harness integration

## Decision

Integrate the sanitized source-quality sample fixture into the offline harness.

Recommended change:

- add a targeted npm script for the sample fixture
- include it in `verify:harness`

## Rationale

Before this fixture, `check:rag-source-quality` skipped unless a response JSON
path was provided. The checker itself is useful, but skip mode means the
default harness does not exercise the source-quality pass path.

The new sample fixture is:

- synthetic
- sanitized
- checked into `docs/rag`
- independent of production APIs
- independent of DB/RAG retrieval
- free of raw provider payload

Therefore it is safe to run in the default offline harness.

## Candidate Script

Add:

```text
check:rag-source-quality:sample
```

Command:

```text
node scripts/check-rag-source-quality.mjs docs/rag/rag-source-quality-sample-response.json
```

Then include it in:

```text
verify:harness
```

## No-Touch Boundary

This integration must not:

- call production APIs
- execute RAG retrieval
- run embeddings/reembedding
- run crawler/import
- read env secrets
- change `/api/chat-ollama`
- change `RAGSearchService`
- change DB/schema

## Verification Plan

Required after implementation:

```text
npm run check:rag-source-quality:sample
npm run check:nodata-boundary
npm run verify:harness
npm run type-check
npm run build
git diff --check
```

## Next Gate

`Compass-RAG-Source-Evidence-4 Harness Integration`

Make the targeted package script change only.
