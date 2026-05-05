# RAG-3K Targeted Sample Insert Plan

Date: 2026-05-05

## Scope

Prepare, but do not execute, INSERT/verify/rollback SQL for adding the 30 RAG-3J targeted candidates to `compass.ollama_document_chunks`.

No DB write, RAG logic change, reembedding, crawler run, production environment change, or rollback was executed while preparing this plan.

## Input

- `C:\Users\Administrator\Downloads\rag3j_targeted_candidates.csv`
- `C:\Users\Administrator\Downloads\rag3j_targeted_candidates_summary.json`

## Output SQL

- `docs/sql/2026-05-05_rag3k_targeted_sample_insert.sql`
- `docs/sql/2026-05-05_rag3k_targeted_sample_verify.sql`
- `docs/sql/2026-05-05_rag3k_targeted_sample_rollback.sql`

## Insert Shape

Target table: `compass.ollama_document_chunks` only.

Columns populated:

- `document_id`: source `document_chunks.document_id`
- `chunk_id`: stable `rag3j_{topic}_{source_vendor}_{source_row_id}`
- `content`: full `compass.document_chunks.content`
- `embedding`: copied `compass.document_chunks.embedding`
- `metadata`: RAG-3K provenance payload
- `created_at`, `updated_at`: `now()`

The INSERT joins back to `compass.document_chunks` and requires:

- matching `source_row_id`
- matching `source_document_id`
- matching `source_chunk_id`
- non-null content
- non-null embedding
- `vector_dims(embedding) = 1024`

## Row Counts

| Metric | Count |
| --- | ---: |
| INSERT manifest rows | 30 |
| price_discount | 15 |
| gambling_policy | 15 |
| KAKAO | 12 |
| NAVER | 3 |
| GOOGLE | 9 |
| META | 6 |

Expected post-insert totals:

| Metric | Expected |
| --- | ---: |
| total `ollama_document_chunks` | 126 |
| RAG-3K rows | 30 |
| RAG-3F rows preserved | 90 |
| original rows preserved | >= 6 |
| RAG-3K embedding non-null | 30 |
| RAG-3K dim min/max | 1024/1024 |
| RAG-3K duplicate chunk_id | 0 |

## Metadata

Each inserted row includes:

- `rag_gate: RAG-3K`
- `topic_target`
- `source_vendor`
- `canonical_title`
- `source_title`
- `source_url`
- `source_document_id`
- `source_chunk_id`
- `source_row_id`
- `topic_labels`
- `quality_score`
- `imported_from: document_chunks`
- `embedding_source: document_chunks.embedding`
- `embedding_dimension: 1024`
- `candidate_audit_gate: RAG-3J`
- `candidate_rank`

## Static Safety Check

- INSERT target is only `compass.ollama_document_chunks`.
- INSERT uses `not exists` and `on conflict do nothing`.
- Verify SQL is SELECT-only.
- Rollback SQL deletes only rows tagged `RAG-3K` or `chunk_id like 'rag3j_%'`.
- Existing original six rows and RAG-3F 90 rows are outside rollback scope.

## Execution Blockers

No blocker found for proceeding to RAG-3L execution approval.

The SQL has not been run.
