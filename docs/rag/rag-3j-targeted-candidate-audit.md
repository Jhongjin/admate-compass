# RAG-3J Targeted Candidate Audit

Date: 2026-05-05

## Scope

RAG-3J audited additional data-only candidates for the two remaining RAG-3H source-only failures:

- `kakao-price-discount`
- `gambling-policy`

The audit used read-only access to:

- `compass.documents`
- `compass.document_chunks`
- `compass.ollama_document_chunks`

No INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER, reembedding, crawling, production environment change, or RAG logic change was performed.

## Artifacts

- SQL: `docs/sql/2026-05-05_rag3j_targeted_candidate_audit.sql`
- CSV: `C:\Users\Administrator\Downloads\rag3j_targeted_candidates.csv`
- Summary: `C:\Users\Administrator\Downloads\rag3j_targeted_candidates_summary.json`

The CSV intentionally excludes raw embedding values. It includes only `embedding_present` and `embedding_dim`.

## Candidate Summary

| Metric | Result |
| --- | --- |
| Raw `price_discount` candidate count | 1,132 |
| Raw `gambling_policy` candidate count | 213 |
| Eligible candidate count after quality filters | 303 |
| Selected audit candidates | 30 |
| Selected `price_discount` candidates | 15 |
| Selected `gambling_policy` candidates | 15 |
| Embedding present | 30/30 |
| Embedding dim min/max | 1024/1024 |
| Existing `ollama_document_chunks` overlap | 0 |
| Noisy/payload candidates | 0 |
| Quality score range | 76-106 |
| Average quality score | 87.93 |

## Vendor Distribution

| Vendor | Selected count |
| --- | ---: |
| KAKAO | 12 |
| GOOGLE | 9 |
| META | 6 |
| NAVER | 3 |

By topic:

| Topic | KAKAO | NAVER | GOOGLE | META | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `price_discount` | 6 | 1 | 6 | 2 | 15 |
| `gambling_policy` | 6 | 2 | 3 | 4 | 15 |

## Metadata and Quality Checks

| Topic | Total | Policy-grade title | Has URL | Existing overlap | Noisy |
| --- | ---: | ---: | ---: | ---: | ---: |
| `price_discount` | 15 | 13 | 14 | 0 | 0 |
| `gambling_policy` | 15 | 15 | 14 | 0 | 0 |

Policy-grade title means the source title includes a policy/guide signal such as `정책`, `운영정책`, `집행기준`, `심사 가이드`, `광고등록기준`, `가이드`, or `클린센터`.

## Candidate Character

### `price_discount`

The selected price/discount set includes:

- KAKAO production/creative guide rows with price, discount, display, material, or copy terms
- GOOGLE Ads policy/help rows with campaign copy or local/service policy context
- NAVER shopping/help row
- META supplemental rows

This directly targets the RAG-3H failure where generic price/discount queries were falling back to original Meta vector seed rows with `keywordScore=0`.

### `gambling_policy`

The selected gambling set includes:

- KAKAO industry guide rows
- NAVER operation policy / business channel guide rows
- META policy rows, including gambling-adjacent policy pages
- GOOGLE Ads policy/consequence rows

This targets the RAG-3H failure where keyword retrieval found related rows but final titles were weak or did not match expected policy title hints.

## Import Recommendation

Recommended RAG-3K sample import size: 30 rows.

Rationale:

- all 30 selected rows have existing `document_chunks.embedding`
- all selected embeddings are dimension 1024
- no selected row overlaps existing `ollama_document_chunks`
- no selected row matched noisy/payload filters
- the set is tightly scoped to the two failing fixture topics
- the set is additive and does not require deleting existing RAG-3F rows

Recommended metadata tag for future import:

```json
{
  "rag_gate": "RAG-3K",
  "imported_from": "document_chunks",
  "embedding_source": "document_chunks.embedding",
  "embedding_dimension": 1024
}
```

Recommended target `chunk_id` prefix:

```text
rag3j_{target_topic}_{source_vendor}_{source_row_id}
```

## Blocker Check

No execution blocker was found for preparing a future sample INSERT SQL.

| Check | Result |
| --- | --- |
| Candidate count within requested range | pass |
| Embedding present | pass |
| Embedding dim 1024 | pass |
| Existing ollama overlap | pass |
| Noisy/payload candidate | pass |
| Source table scope | pass |
| DB write performed | no |

## Risks

- Some GOOGLE and META price candidates may be policy-adjacent rather than exact Korean price-display policy evidence. RAG-3K should preserve the CSV preview review step before import.
- Some gambling candidates are broad policy pages. They are better than the current weak keyword titles, but source title normalization may still be needed if fixture title hints remain strict.
- The original six Meta seed rows may still rank highly for generic questions. Data-only cleanup should be measured before applying RAG scoring changes.

## Next Approval

```text
Gate RAG-3K targeted sample INSERT SQL 준비를 승인한다.

입력:
- C:\Users\Administrator\Downloads\rag3j_targeted_candidates.csv
- C:\Users\Administrator\Downloads\rag3j_targeted_candidates_summary.json

목표:
- 30개 targeted 후보를 compass.ollama_document_chunks에 추가하기 위한 INSERT/verify/rollback SQL을 준비한다.
- embedding은 compass.document_chunks.embedding을 복사한다.
- 아직 INSERT는 실행하지 않는다.
- RAG 로직, DB schema, production env, crawler, reembedding은 변경하지 않는다.
```
