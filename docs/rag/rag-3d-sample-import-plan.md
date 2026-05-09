# RAG-3D Sample Import Plan

Date: 2026-05-05

Scope: select a balanced sample from the RAG-3C candidate CSV and prepare import planning. No DB connection, INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER, reembedding, crawler, RAG logic, production env, or schema change was executed.

## Inputs

- `C:\Users\Administrator\Downloads\rag3c_ollama_candidates.csv`
- `C:\Users\Administrator\Downloads\rag3c_ollama_candidates_summary.json`

## Outputs

- `C:\Users\Administrator\Downloads\rag3d_selected_sample_manifest.csv`
- `C:\Users\Administrator\Downloads\rag3d_selected_sample_summary.json`
- `docs/sql/2026-05-05_rag3d_ollama_sample_import.sql`

The SQL file is intentionally non-executable because the input CSV does not include full content or embeddings.

## Sample Selection Result

Selected sample size: 90 rows.

| Vendor | Selected rows |
| --- | ---: |
| `KAKAO` | 35 |
| `GOOGLE` | 25 |
| `NAVER` | 15 |
| `META` | 15 |

The requested baseline was Kakao 30, Google 20, Generic 20, Naver 10, Meta 10. Because generic rows are distributed across vendors, the final vendor count is intentionally higher for Kakao and Google while keeping Naver and Meta supplements.

## Bucket Distribution

| Bucket | Rows |
| --- | ---: |
| `KAKAO:review` | 12 |
| `KAKAO:youth` | 8 |
| `KAKAO:service-protection` | 8 |
| `KAKAO:policy-fill` | 2 |
| `GOOGLE:policy` | 16 |
| `GOOGLE:policy-fill` | 4 |
| `GENERIC:KAKAO` | 5 |
| `GENERIC:GOOGLE` | 5 |
| `GENERIC:NAVER` | 5 |
| `GENERIC:META` | 5 |
| `NAVER:policy-help` | 10 |
| `META:supplement` | 10 |

## Fixture Coverage

| Fixture | Selected candidate count |
| --- | ---: |
| `kakao-review-standards` | 13 |
| `kakao-youth-harmful-content` | 13 |
| `kakao-price-discount` | 11 |
| `kakao-kakao-service-protection` | 15 |
| `google-ads-policy` | 22 |
| `gambling-policy` | 6 |

## Quality Score Distribution

| Metric | Value |
| --- | ---: |
| min | 96 |
| max | 124 |
| avg | 107.76 |

## Duplicate Checks

| Check | Result |
| --- | ---: |
| duplicate `source_row_id` | 0 |
| duplicate content fingerprint | 0 |
| repeated `source_chunk_id` groups | 14 |

The repeated `source_chunk_id` groups need review before import. They likely come from source rows where `chunk_id` is not globally unique enough by itself. A future stable target chunk id should include source vendor plus source row id or document id, not only source chunk id.

Recommended future stable chunk id:

```text
rag3d_{source_vendor}_{source_row_id}
```

Alternative:

```text
rag3d_{source_vendor}_{source_document_id}_{source_chunk_id}
```

## Blocker: Full Content Missing

The RAG-3C CSV has:

- `content_preview`
- `content_length`
- source ids and metadata candidates

It does not have full chunk `content`.

An executable INSERT should not use `content_preview` as final content because it may truncate policy evidence and weaken RAG quality.

## Blocker: Embedding Missing

The RAG-3C CSV has no embedding vectors.

Therefore executable `insert into compass.ollama_document_chunks (...)` SQL cannot be prepared yet under the approved rules.

Future approved options:

1. SELECT-only full-content rehydration:
   - Join selected `source_row_id` / `source_document_id` / `source_chunk_id` back to `compass.document_chunks`.
   - Export full content.
2. Embedding generation:
   - Generate vector(1024) embeddings for the selected 90 full content rows using the same embedding strategy as current Compass MVP.
   - Or explicitly approve copying an existing compatible embedding if available and semantically acceptable.
3. Target SQL generation:
   - Only after full content and embeddings exist.
   - Target table must be `compass.ollama_document_chunks` only.

## Proposed Metadata For Future Insert

Each future row should include:

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
  "imported_from": "document_chunks_candidate_export"
}
```

## SQL File Status

`docs/sql/2026-05-05_rag3d_ollama_sample_import.sql` contains only a no-op status SELECT and comments.

It contains no executable INSERT because:

- full content is absent
- embedding is absent

## RAG-3E Recommendation

Approve a new preparation gate before any import:

1. Rehydrate full content for the 90 selected rows using SELECT-only query.
2. Decide embedding strategy for vector(1024):
   - generate new embeddings, or
   - copy compatible existing embeddings if explicitly approved.
3. Produce a final executable INSERT SQL only after both full content and embeddings are present.

## Next Approval Wording

Approve Gate RAG-3E full-content rehydration and embedding strategy planning:

- Use `rag3d_selected_sample_manifest.csv`.
- SELECT-only rehydrate full content from `compass.document_chunks`.
- Do not INSERT.
- Do not generate embeddings until strategy is approved.
- Report full-content availability, duplicate target chunk id strategy, and embedding options.
