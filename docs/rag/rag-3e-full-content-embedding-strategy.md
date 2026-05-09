# RAG-3E Full Content Rehydration / Embedding Strategy

Date: 2026-05-05

Scope: rehydrate full content for the 90 RAG-3D sample candidates and evaluate embedding strategy. No INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER, reembedding, crawler, RAG logic, production env, DB schema, or data change was executed.

## Inputs

- `C:\Users\Administrator\Downloads\rag3d_selected_sample_manifest.csv`
- `C:\Users\Administrator\Downloads\rag3d_selected_sample_summary.json`

## Outputs

- `C:\Users\Administrator\Downloads\rag3e_rehydrated_sample_preview.csv`
- `C:\Users\Administrator\Downloads\rag3e_rehydrated_sample_summary.json`
- `docs/sql/2026-05-05_rag3e_full_content_rehydration.sql`

## Rehydration Result

| Check | Result |
| --- | ---: |
| expected rows | 90 |
| matched rows | 90 |
| full content present | 90 |
| embedding present | 90 |
| embedding dimension min | 1024 |
| embedding dimension max | 1024 |
| content length min | 363 |
| content length max | 928 |
| content length avg | 665.06 |
| short content `< 80` | 0 |
| long content `> 2400` | 0 |
| noisy candidate count | 0 |
| existing `ollama_document_chunks` overlap | 0 |
| duplicate target chunk id groups | 0 |
| duplicate full content hash groups | 0 |

## Matching Method

Rows were matched back to `compass.document_chunks` using:

1. `source_row_id = document_chunks.id`
2. fallback: `source_document_id = document_chunks.document_id` and `source_chunk_id = document_chunks.chunk_id`

All 90 rows matched.

## Full Content

All 90 selected candidates have full `document_chunks.content`.

The RAG-3C CSV only had `content_preview`, but RAG-3E successfully rehydrated full content from the source table.

## Embedding Strategy Review

### Option 1: Copy `compass.document_chunks.embedding`

Status: recommended.

Evidence:

- 90/90 source rows have embedding.
- embedding dimension min/max is `1024,1024`.
- Existing Compass schema and search RPC already operate on vector(1024).
- No reembedding required.
- Lowest operational risk for sample import.

### Option 2: Regenerate with `SimpleEmbeddingService`

Status: not recommended for RAG-3F.

Reason:

- Adds a transformation step without improving corpus coverage certainty.
- Could drift from existing `document_chunks.embedding` values.
- Reembedding was explicitly out of scope for RAG-3E.

### Option 3: Regenerate with Ollama or another embedding model

Status: later backlog only.

Reason:

- Requires model selection, runtime availability, latency/cost checks, and compatibility testing.
- Would create a new embedding regime that should be evaluated as a separate migration.

## Recommended Strategy

Use Option 1 for RAG-3F:

```text
copy compass.document_chunks.embedding into compass.ollama_document_chunks.embedding
```

This is a data-only promotion from raw chunk corpus to vector-ready chat corpus.

## Target Chunk ID Rule

Recommended target `chunk_id`:

```text
rag3d_{source_vendor}_{source_row_id}
```

Reason:

- `source_chunk_id` was not unique enough in RAG-3D sampling.
- `source_row_id` is unique in the selected manifest.
- RAG-3E duplicate check found 0 duplicate target chunk ids using this rule.

Example shape:

```text
rag3d_KAKAO_doc_..._chunk_...
```

Sanitize non-alphanumeric characters to `_` when generating SQL.

## Duplicate Risk

| Duplicate check | Result |
| --- | ---: |
| existing `ollama_document_chunks` overlap by document/chunk/content hash | 0 |
| duplicate proposed target chunk id groups | 0 |
| duplicate full content hash groups | 0 |

No duplicate blocker found for the 90-row sample.

## Metadata Final Draft

Future RAG-3F insert metadata should include:

```json
{
  "source_vendor": "...",
  "canonical_title": "...",
  "source_title": "...",
  "source_url": "...",
  "source_document_id": "...",
  "source_chunk_id": "...",
  "topic_labels": ["..."],
  "fixture_matches": ["..."],
  "quality_score": 0,
  "rag_gate": "RAG-3D",
  "imported_from": "document_chunks_candidate_export",
  "embedding_strategy": "copy_document_chunks_embedding",
  "embedding_dimension": 1024
}
```

## RAG-3F Readiness

RAG-3F sample INSERT SQL preparation is possible.

Requirements for RAG-3F:

1. Use `rag3e_rehydrated_sample_preview.csv` or regenerate the same SELECT with full content and embedding.
2. Generate `insert into compass.ollama_document_chunks` only.
3. Use `document_id = source_document_id`.
4. Use `chunk_id = rag3d_{source_vendor}_{source_row_id}`.
5. Use full content, not preview.
6. Copy `document_chunks.embedding`.
7. Insert 90 rows maximum.
8. Use `on conflict do nothing`.
9. Prepare rollback SQL for only `chunk_id like 'rag3d_%'`.

## Next Approval Wording

Approve Gate RAG-3F sample INSERT SQL generator:

- Generate executable INSERT SQL for 90 RAG-3D sample rows.
- Target only `compass.ollama_document_chunks`.
- Copy full content and `document_chunks.embedding`.
- Do not execute the SQL yet.
- Include verify and rollback SQL.
