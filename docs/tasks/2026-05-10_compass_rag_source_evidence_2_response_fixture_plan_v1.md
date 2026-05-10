# Compass RAG Source Evidence 2 Response Fixture Plan v1

Date: 2026-05-10
Status: completed
Scope: sanitized source-quality response fixture

## Goal

Create a small sanitized response fixture so `check:rag-source-quality` can run
in pass mode without calling production APIs or copying raw provider output.

## Fixture

Added:

```text
docs/rag/rag-source-quality-sample-response.json
```

The fixture is synthetic and contract-oriented. It is not a captured production
response.

## Coverage

The fixture covers:

- top-level confidence
- response message
- source array
- source id/title/excerpt
- similarity or score in the expected range
- retrieval method
- non-fallback source quality
- quality score in the expected range

It avoids:

- raw provider payload
- internal database row dumps
- token/cookie/session values
- embedding vectors
- raw chunk text beyond short sanitized excerpts

## Verification

Run:

```text
node scripts/check-rag-source-quality.mjs docs/rag/rag-source-quality-sample-response.json
```

Expected:

```text
[check-rag-source-quality] ok
```

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

## Next Gate

`Compass-RAG-Source-Evidence-3 Fixture Harness Integration Decision`

Decide whether the sample fixture should be wired into `verify:harness` or kept
as an explicit targeted check.
