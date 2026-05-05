# RAG-2C Evaluation Baseline

Date: 2026-05-05

## Scope

Gate RAG-2C measured the current hybrid RAG quality against the 20 RAG-2B fixtures.

No RAG retrieval logic, DB schema, embeddings, production environment, or data were changed.

## Commands

Local endpoint:

```bash
npm run evaluate:rag-fixtures -- --run
```

Production endpoint was evaluated separately against:

```text
https://compass.admate.ai.kr/api/chat-ollama
```

Post-run checks:

```bash
npm run verify:harness
npm run smoke:chat-ollama-local
```

## Local Baseline

Endpoint:

```text
http://127.0.0.1:3000/api/chat-ollama
```

Result:

| Metric | Value |
| --- | ---: |
| Fixtures | 20 |
| Passed | 6 |
| Failed | 14 |
| Pass rate | 30% |
| Total returned sources | 60 |
| Source corpus | 60 `ollama_document_chunks` |
| Retrieval methods | 15 `hybrid`, 45 `vector` |
| Evidence types | 15 `hybrid`, 45 `vector` |
| Source quality warnings | 54 `missing_url` |

Passing fixtures:

- `meta-image-ad-specs`
- `meta-video-ad-specs`
- `meta-carousel-specs`
- `instagram-ad-specs`
- `meta-policy-general`
- `adult-content-policy`

Local failure categories:

| Failure category | Count |
| --- | ---: |
| `expectedSourceTitle` | 10 |
| `mustContain` | 10 |
| `retrievalMethod` | 5 |
| `mustNotContain` | 2 |
| `noDataFound_mismatch` | 2 |

## Production Baseline

Endpoint:

```text
https://compass.admate.ai.kr/api/chat-ollama
```

Result:

| Metric | Value |
| --- | ---: |
| Fixtures | 20 |
| Passed | 3 |
| Failed | 17 |
| Pass rate | 15% |
| Total returned sources | 60 |
| Source corpus | 60 `ollama_document_chunks` |
| Retrieval methods | 15 `hybrid`, 45 `vector` |
| Evidence types | 15 `hybrid`, 45 `vector` |
| Source quality warnings | 54 `missing_url` |
| Generation model state | `ollama-connection-failed` |

Passing fixtures:

- `meta-image-ad-specs`
- `instagram-ad-specs`
- `meta-policy-general`

Production failure categories:

| Failure category | Count |
| --- | ---: |
| `mustContain` | 29 |
| `expectedSourceTitle` | 10 |
| `retrievalMethod` | 5 |
| `mustNotContain` | 2 |
| `noDataFound_mismatch` | 2 |

Production underperforms local because Ollama generation is intentionally outside the production MVP. The fixture evaluator currently checks `mustContain` across answer text plus sources, so generation failure makes answer-text assertions stricter than retrieval-only assertions.

## Key Findings

1. `document_chunks` keyword candidates are not making it into the final top sources.
   - Final sources are still entirely `ollama_document_chunks`.
   - This confirms RAG-2A candidate collection exists, but ranking favors the six Ollama chunks too strongly.

2. Vendor/source routing is weak for non-Meta queries.
   - Kakao, Naver, and Google questions often return Meta/Facebook sources.
   - `expectedSourceTitle` failures are the most common retrieval-quality issue.

3. Out-of-scope rejection is not working.
   - Weather and recipe questions returned sources with `noDataFound=false`.
   - Current vector scores are high enough to pass evidence gate even when the query is unrelated.

4. Source metadata quality is incomplete.
   - `missing_url` appears 54 times across 60 returned sources.
   - This is a metadata quality issue, not an immediate response-contract failure.

5. Duplicate title/source diversity is acceptable in this baseline.
   - No duplicate-title failures appeared.
   - Sources generally had three distinct titles.

6. Confidence is too forgiving.
   - Failed retrievals still report confidence around the high 60s to low 70s.
   - Confidence currently tracks retrieval score more than vendor/topic correctness.

## RAG-2D Improvement Priorities

1. Add lexical/topic evidence gate.
   - Require at least one meaningful query term or vendor/topic match in final evidence.
   - This should fix out-of-scope questions and reduce false-positive Meta matches.

2. Rebalance hybrid ranking.
   - Boost `document_chunks` keyword hits when they satisfy title/content terms.
   - Penalize vector-only results when keyword score is zero for policy-specific questions.

3. Add vendor/source intent scoring.
   - Detect Kakao, Meta, Google, Naver, Instagram, Facebook terms from query.
   - Prefer matching source titles/metadata and penalize mismatched vendors.

4. Separate retrieval-only fixture checks from generation-answer checks.
   - Production MVP can preserve verified sources while generation remains unavailable.
   - The evaluator should optionally check sources-only fields for production.

5. Tighten confidence calculation.
   - Penalize vendor mismatch, keyword miss, and out-of-scope signals.
   - Avoid high confidence when all sources are vector-only and topic terms are absent.

6. Improve source metadata quality backlog.
   - Fill or derive URL/title metadata where possible.
   - Keep DB/data changes separate from RAG-2D unless explicitly approved.

## Verification

Passed:

- `npm run verify:harness`
- `npm run smoke:chat-ollama-local`

Expected failure:

- `npm run evaluate:rag-fixtures -- --run` exits non-zero because it is a baseline quality gate and 14 local fixtures currently fail.
