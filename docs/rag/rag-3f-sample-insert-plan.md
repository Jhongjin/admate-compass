# RAG-3F Sample Insert SQL Plan

Date: 2026-05-05

Scope: prepare sample INSERT, verify, and rollback SQL for the 90-row RAG-3D/3E vector-ready corpus expansion. No SQL was executed. No DB write, reembedding, crawler, RAG logic, production env, or schema change was performed.

## Inputs

- `C:\Users\Administrator\Downloads\rag3e_rehydrated_sample_preview.csv`
- `C:\Users\Administrator\Downloads\rag3e_rehydrated_sample_summary.json`

## Prepared SQL Files

- `docs/sql/2026-05-05_rag3f_ollama_sample_insert.sql`
- `docs/sql/2026-05-05_rag3f_ollama_sample_verify.sql`
- `docs/sql/2026-05-05_rag3f_ollama_sample_rollback.sql`

## Insert Scope

Target table:

- `compass.ollama_document_chunks`

No other target table is used.

Prepared insert row count:

- 90

Existing six `ollama_document_chunks` rows are preserved. The INSERT uses `on conflict do nothing` and a `not exists` guard for the RAG-3F target chunk id/source row id.

## Insert Mapping

| Target column | Source |
| --- | --- |
| `document_id` | `source_document_id` from manifest |
| `chunk_id` | `rag3d_{source_vendor}_{source_row_id}` |
| `content` | full `compass.document_chunks.content` |
| `embedding` | copied `compass.document_chunks.embedding` |
| `metadata` | generated JSONB with RAG-3F fields |
| `created_at` | `now()` |
| `updated_at` | `now()` |

## Metadata Fields

Each row will include:

- `rag_gate = RAG-3F`
- `source_vendor`
- `canonical_title`
- `source_title`
- `source_url`
- `source_document_id`
- `source_chunk_id`
- `source_row_id`
- `topic_labels`
- `fixture_matches`
- `quality_score`
- `imported_from = document_chunks`
- `embedding_source = document_chunks.embedding`
- `embedding_dimension`
- `full_content_hash`
- `sample_bucket`
- `created_by_gate = RAG-3F`

## Sample Distribution

| Vendor | Rows |
| --- | ---: |
| `KAKAO` | 35 |
| `GOOGLE` | 25 |
| `NAVER` | 15 |
| `META` | 15 |

Fixture coverage:

| Fixture | Rows |
| --- | ---: |
| `kakao-review-standards` | 13 |
| `kakao-youth-harmful-content` | 13 |
| `kakao-price-discount` | 11 |
| `kakao-kakao-service-protection` | 15 |
| `google-ads-policy` | 22 |
| `gambling-policy` | 6 |

## Static Safety Check

| Check | Result |
| --- | --- |
| INSERT target | `compass.ollama_document_chunks` only |
| INSERT row values | 90 |
| verify SQL DML/DDL | none |
| rollback target | `compass.ollama_document_chunks` only |
| rollback scope | `metadata->>'rag_gate' = 'RAG-3F'` or `chunk_id like 'rag3d_%'` |
| raw embedding printed in SQL | no |

## Sequence Reset

No sequence reset is expected.

Reason:

- Insert does not provide or depend on a numeric identity column.
- Target row identity is controlled by `chunk_id` and existing table columns.

## Verify SQL

The verify file checks:

- total `ollama_document_chunks`
- RAG-3F row count
- original rows preserved
- RAG-3F embedding non-null count
- vector dimension min/max
- duplicate chunk id count
- vendor counts
- fixture counts
- RPC self-match count using a RAG-3F embedding

Expected post-import headline:

| Check | Expected |
| --- | ---: |
| total `ollama_document_chunks` | 96 |
| RAG-3F rows | 90 |
| original rows preserved | at least 6 |
| RAG-3F embedding non-null | 90 |
| vector dims | 1024,1024 |
| duplicate chunk id count | 0 |

## Rollback SQL

Rollback file:

- deletes only rows where `metadata->>'rag_gate' = 'RAG-3F'`
- or `chunk_id like 'rag3d_%'`

It does not target the original six rows unless they are incorrectly tagged with RAG-3F, which they are not expected to be.

Rollback is prepared but must not be executed without explicit approval.

## Blockers

No preparation blocker remains.

RAG-3G can execute the sample import if approved.

## Next Approval Wording

Approve Gate RAG-3G sample import execution:

- Run `docs/sql/2026-05-05_rag3f_ollama_sample_insert.sql` in Admate-Vision SQL Editor.
- Then run `docs/sql/2026-05-05_rag3f_ollama_sample_verify.sql`.
- Do not run rollback unless explicitly requested.
- Do not change schema, production env, crawler, embeddings, or RAG logic.
