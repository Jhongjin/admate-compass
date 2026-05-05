# RAG-2 Hybrid Search Foundation

Gate RAG-2A extends Compass retrieval from vector-first fallback into a deterministic hybrid candidate pipeline.

## Scope

- Keep the existing `/api/chat-ollama` response contract.
- Add first-class vector and keyword candidate channels.
- Use `compass.ollama_document_chunks` for vector candidates through `search_ollama_documents`.
- Use `compass.ollama_document_chunks` and `compass.document_chunks` for keyword candidates.
- Treat `document_chunks` as keyword-only in this gate.
- Do not change DB schema, embeddings, production env, or imported data.

## Candidate Metadata

Each source may include:

- `hybridScore`
- `vectorScore`
- `keywordScore`
- `corpus`
- `evidenceType`
- `rankReason`
- `retrievalMethod`
- `sourceQuality`

Existing fields remain intact.

## Ranking Draft

Hybrid score currently weights:

- vector score: 55%
- keyword score: 25%
- source quality: 20%
- hybrid match boost: 8%

This is intentionally deterministic and lightweight. Later gates can replace keyword scoring with BM25 or a reranker.

## Dedupe And Diversity

Candidates are deduped by:

- chunk id
- document id + chunk index
- content fingerprint

Final results are capped to avoid over-representing the same document or title.

## Evidence Gate

Fallback, mock, and empty sources are not valid grounding evidence.

`noDataFound` should remain true when no verified source survives retrieval, dedupe, and evidence gating.

## Next Gates

1. Add fixture-based evaluation for hybrid recall and source diversity.
2. Tune keyword tokenization and stopwords for Korean policy queries.
3. Improve source metadata linking for weak or orphaned chunks.
4. Evaluate whether `document_chunks` should become a vector corpus after controlled re-embedding.
