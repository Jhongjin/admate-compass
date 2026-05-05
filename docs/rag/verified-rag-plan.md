# Compass Verified RAG Plan

Gate RAG-1 keeps the existing `/api/chat-ollama` response contract while making retrieved sources auditable.

## Retrieval Contract

Each source returned by the chat path should expose:

- `retrievalMethod`: `vector`, `keyword`, or `fallback`
- `score`: normalized retrieval score
- `documentId`
- `chunkId`
- `sourceQuality`

`fallback` sources are not valid grounding evidence for generated answers.

## Guardrail

The chat route must not generate an answer when no verified source exists.

Verified source requirements:

- non-empty excerpt/content
- not fallback-only
- source metadata is carried into the response

If verified sources are absent, the route returns the existing `noDataFound=true` response shape.

## Next Gates

1. Hybrid retrieval: run vector and keyword retrieval as first-class parallel retrieval methods.
2. Citation verification: require answer claims to map to source excerpts.
3. Data quality: regenerate `ollama_document_chunks` with linked `document_id` values.
4. Evaluation harness: add fixture-based policy QA checks.
