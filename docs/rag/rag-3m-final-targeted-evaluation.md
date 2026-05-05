# RAG-3M Final Targeted Evaluation

Date: 2026-05-05

## Scope

RAG-3M measured the effect of the RAG-3K targeted data-only sample import.

RAG-3K inserted 30 targeted rows into `compass.ollama_document_chunks`:

- `price_discount`: 15
- `gambling_policy`: 15

No RAG logic, DB schema, production environment, crawler, reembedding, rollback, or source table mutation was performed.

## RAG-3L Import Verification

RAG-3K targeted import succeeded.

| Check | Result |
| --- | ---: |
| Insert attempted | 30 |
| Inserted rows | 30 |
| Insert errors | 0 |
| Total `ollama_document_chunks` | 126 |
| RAG-3K rows | 30 |
| RAG-3F rows preserved | 90 |
| Original rows preserved | 6 |
| `price_discount` rows | 15 |
| `gambling_policy` rows | 15 |
| RAG-3K embedding non-null | 30 |
| Vector dim min/max | 1024/1024 |
| Duplicate RAG-3K chunk_id | 0 |
| RPC self-match count | 5 |

RAG-3K vendor distribution:

| Vendor | Count |
| --- | ---: |
| KAKAO | 12 |
| GOOGLE | 9 |
| META | 6 |
| NAVER | 3 |

## Local Evaluation

Local endpoint:

- `http://127.0.0.1:3004/api/chat-ollama`
- `COMPASS_DB_SCHEMA=compass`

Commands:

- `npm run evaluate:rag-fixtures -- --run`
- `npm run evaluate:rag-fixtures -- --run --diagnostics`
- `npm run smoke:chat-ollama-local`

Result:

| Metric | RAG-3H | RAG-3M |
| --- | ---: | ---: |
| Source-only pass | 18/20 | 18/20 |
| Source-only fail | 2 | 2 |
| Generation assertion fail | 4 | 4 |
| Vendor-specific pass | 10/10 | 10/10 |
| Generic-policy pass | 6/8 | 6/8 |
| Out-of-scope pass | 2/2 | 2/2 |
| Local smoke | pass | pass |

Local smoke:

- `schema=compass`
- `noDataFound=false`
- `sourcesCount=3`
- `confidence=85.91`
- source metadata retained

## Remaining Failures

The two RAG-3H failures remained unchanged after RAG-3K.

### `kakao-price-discount`

Failure:

```text
expected one of retrieval methods keyword, hybrid, received vector
```

Final top sources:

| Rank | Title | Vendor | Corpus | Method | RAG-3K? |
| --- | --- | --- | --- | --- | --- |
| 1 | 인스타그램 광고 사양 | META | `ollama_document_chunks` | vector | no |
| 2 | 페이스북 광고 정책 | META | `ollama_document_chunks` | vector | no |
| 3 | 메타 광고 정책 2024 | META | `ollama_document_chunks` | vector | no |

Interpretation:

- RAG-3K price rows inserted correctly but did not enter final sources.
- Original six Meta seed rows still dominate vector retrieval for this generic price/discount query.
- This is now primarily a ranking/evidence gate issue rather than a corpus availability issue.

### `gambling-policy`

Failure:

```text
sources do not match expected title hints
```

Final top sources:

| Rank | Title | Vendor | Corpus | Method | RAG-3K? |
| --- | --- | --- | --- | --- | --- |
| 1 | 네이버 광고 가이드: 타겟팅 확대와 예산 조정으로 광고 성과 높이기광고운영팁4분 | inferred META | `document_chunks` | keyword | no |
| 2 | 네이버 광고 가이드: 클린센터 | NAVER | `document_chunks` | keyword | no |
| 3 | 네이버 광고 가이드: 클린센터 | NAVER | `document_chunks` | keyword | no |

Interpretation:

- RAG-3K gambling rows inserted correctly but did not enter final sources.
- Existing `document_chunks` keyword candidates still outrank vector-ready RAG-3K rows.
- The remaining issue is source ranking/title quality, not absence of gambling candidates.

## RAG-3K Source Usage

RAG-3K final source usage in the 20-fixture local diagnostic run:

| Metric | Result |
| --- | ---: |
| Fixtures with RAG-3K final source | 0 |
| RAG-3K final source count | 0 |
| RAG-3F final source count | 11 |

This confirms that data-only insertion alone is insufficient for the two remaining failures. The current retrieval/ranking path still prefers:

- original Meta seed vector rows for `kakao-price-discount`
- `document_chunks` keyword rows for `gambling-policy`

## Production Smoke

Production endpoint:

- `https://compass.admate.ai.kr/api/chat-ollama`

Production smoke results:

| Query | schema | noDataFound | sourcesCount | model | Notes |
| --- | --- | --- | ---: | --- | --- |
| 광고 심사 기준은 무엇인가요? | compass | false | 3 | `ollama-connection-failed` | verified sources preserved |
| 광고 소재에 가격이나 할인율을 표시할 때 기준은? | compass | false | 3 | `ollama-connection-failed` | same Meta vector seed pattern |
| 도박이나 사행성 표현은 광고에 쓸 수 있나요? | compass | false | 3 | `ollama-connection-failed` | same document_chunks keyword pattern |

Production remains healthy for Compass MVP source retrieval:

- `schema=compass` maintained
- `sourcesCount >= 1` maintained
- `sourceQuality` retained
- Ollama generation remains a separate backlog

## Regression Check

No regression was observed:

- vendor-specific fixtures remain `10/10`
- out-of-scope weather/recipe remain `noDataFound=true`
- duplicate source failure count remains `0`
- local smoke still passes
- production source fallback still preserves verified sources

## Rollback Judgment

Rollback is not required immediately.

RAG-3K did not improve the target fixtures, but it also did not regress evaluation, source contract, or production smoke. The rows are cleanly tagged with `RAG-3K`, have valid 1024-dimension embeddings, and can remain as dormant targeted corpus while ranking logic is corrected.

Rollback can be considered only if keeping unused targeted rows is undesirable. If needed, use the prepared RAG-3K rollback SQL, which deletes only:

- `metadata->>'rag_gate' = 'RAG-3K'`
- or `chunk_id like 'rag3j_%'`

It does not affect original six rows or RAG-3F rows.

## Recommended Next Step

Proceed to RAG-3N ranking/evidence-gate tuning, not more data-only imports.

Recommended scope:

1. For generic policy questions, penalize vector-only sources when keyword/hybrid policy candidates exist.
2. Add a title-quality boost for `정책`, `운영정책`, `집행기준`, `심사 가이드`, `광고등록기준`, `가이드`, `클린센터`.
3. Add exact query critical-term coverage boost:
   - price: `가격`, `할인`, `할인율`
   - gambling: `도박`, `사행`, `사행성`
4. Prefer RAG-3K/RAG-3F `ollama_document_chunks` candidates when their keywordScore or lexical overlap is strong.
5. Keep original Meta seed rows strong for Meta-specific fixtures, but demote them for generic non-Meta policy questions when they are vector-only and missing URL.

Suggested approval:

```text
Gate RAG-3N generic policy ranking/evidence gate tuning 설계를 승인한다.

목표:
- RAG-3K data가 final source에 올라오지 못한 원인을 RAGSearchService ranking/evidence gate 기준에서 해결한다.
- 아직 구현하지 말고 설계만 보고한다.
- DB schema, data import, reembedding, production env 변경은 금지한다.
```
