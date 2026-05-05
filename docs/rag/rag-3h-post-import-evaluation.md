# RAG-3H Post-import RAG Evaluation

Date: 2026-05-05

## Scope

RAG-3H measured the effect of the RAG-3F `compass.ollama_document_chunks` sample expansion after importing 90 balanced vector-ready rows copied from `compass.document_chunks`.

No RAG logic, DB schema, environment setting, reembedding, crawling, rollback, or additional data mutation was performed during this evaluation.

## Execution

Local endpoint:

- `http://127.0.0.1:3004/api/chat-ollama`
- `COMPASS_DB_SCHEMA=compass`

Commands:

- `npm run evaluate:rag-fixtures -- --run`
- `npm run evaluate:rag-fixtures -- --run --diagnostics`
- `npm run smoke:chat-ollama-local`

Production endpoint:

- `https://compass.admate.ai.kr/api/chat-ollama`

Production was checked with direct POST smoke requests because the local smoke script treats `response.error=true` as a hard failure. Production currently preserves verified sources while Ollama generation remains unavailable.

## Local Results

Source-only evaluation improved from the RAG-2H baseline of `14/20` to `18/20`.

| Metric | Result |
| --- | --- |
| Fixture count | 20 |
| Source-only pass | 18 |
| Source-only fail | 2 |
| Generation assertion fail | 4 |
| Vendor-specific pass | 10/10 |
| Generic-policy pass | 6/8 |
| Out-of-scope pass | 2/2 |
| Local smoke | pass |
| Local smoke schema | compass |
| Local smoke sourcesCount | 3 |
| Local smoke confidence | 85.91 |

Retrieval/source distribution across final fixture sources:

| Metric | Result |
| --- | --- |
| Total final sources | 52 |
| `ollama_document_chunks` sources | 40 |
| `document_chunks` sources | 12 |
| RAG-3F `rag3d_*` sources | 11 |
| Retrieval methods | hybrid 25, keyword 17, vector 10 |
| Source vendors | META 33, KAKAO 9, NAVER 7, GOOGLE 2, UNKNOWN 1 |
| Missing URL warnings | 41 source instances |
| Duplicate-title failures | 0 |

Confidence:

| Metric | Value |
| --- | --- |
| Average | 60.95 |
| Minimum | 0 |
| Maximum | 86.63 |

## Improved Fixtures

The prior RAG-2H source-only failures were:

- `kakao-review-standards`
- `kakao-youth-harmful-content`
- `kakao-price-discount`
- `kakao-kakao-service-protection`
- `google-ads-policy`
- `gambling-policy`

After RAG-3F import, these improved to pass:

- `kakao-review-standards`
- `kakao-youth-harmful-content`
- `kakao-kakao-service-protection`
- `google-ads-policy`

RAG-3F rows appeared in final sources for:

- `kakao-review-standards`
- `kakao-youth-harmful-content`
- `kakao-false-exaggerated`
- `kakao-user-deception`
- `kakao-kakao-service-protection`
- `google-ads-policy`
- `trademark-rights-policy`

This confirms that the new `ollama_document_chunks` sample rows are no longer merely stored data. They are participating in vector/hybrid retrieval.

## Remaining Failures

| Fixture | Failure | Current top-source pattern | Likely cause |
| --- | --- | --- | --- |
| `kakao-price-discount` | Required keyword/hybrid, received vector | Meta original seed rows from `ollama_document_chunks` | Generic price/discount query still allows high simple-vector Meta seed matches; RAG-3F price candidates are not strong enough in final ranking |
| `gambling-policy` | Expected title hints mismatch | `document_chunks` keyword sources, mostly Naver/META-inferred titles | Fixture expects gambling-policy title evidence, but the available chunks surface noisy or weakly titled policy fragments |

No out-of-scope regression was observed:

- `out-of-scope-weather`: `noDataFound=true`, sourcesCount `0`, pass
- `out-of-scope-recipe`: `noDataFound=true`, sourcesCount `0`, pass

## Production Smoke

Production retrieval remains healthy for Compass MVP source mode:

General query:

- HTTP JSON response: yes
- `schema=compass`
- `noDataFound=false`
- `sourcesCount=3`
- `model=ollama-connection-failed`
- verified sources preserved: yes
- endpoint URL/secret values exposed: no

Kakao query:

- HTTP JSON response: yes
- `schema=compass`
- `noDataFound=false`
- `sourcesCount=3`
- top sources include RAG-3F `rag3d_KAKAO_*` rows
- `retrievalMethod` includes `hybrid` and `keyword`
- `sourceQuality` preserved
- Ollama generation still unavailable and remains backlog

Production smoke script exit was not used as the final production judgment because it currently fails on `response.error=true`. Raw response inspection confirmed the MVP fallback contract: retrieval succeeds and verified sources are preserved while generation fails.

## Quality Notes

- The biggest improvement is vendor-specific coverage: `10/10` now pass.
- Kakao and Google vector-ready coverage improved because RAG-3F rows are now selected from `ollama_document_chunks`.
- `document_chunks` still matters as keyword corpus, especially for Naver and generic policy questions.
- `missing_url` remains noisy. Many `document_chunks` rows lack direct URL metadata, and original six Meta seed rows still lack URL linkage.
- Some source vendor inference is still imperfect. One gambling result displayed a Naver title with inferred `META`, indicating title/content/vendor heuristics still need cleanup.
- Generation assertions remain separate from source-only quality because production MVP intentionally excludes Ollama generation as a blocker.

## RAG-3I Recommendations

1. Add a source-only evaluation mode for production smoke so Ollama failure does not mask retrieval health.
2. Add a targeted `price/discount` RAG-3I sample or ranking adjustment so generic price fixtures do not fall back to Meta vector-only seed rows.
3. Add a targeted gambling/source-title cleanup pass:
   - inspect gambling candidate chunks
   - normalize title/vendor inference
   - consider adding a few high-quality gambling policy rows into `ollama_document_chunks`
4. Improve metadata quality:
   - prefer recovered document URL from `documents.url` or `documents.metadata.source_url`
   - surface URL provenance in `sourceQuality`
5. Add a duplicate/original seed cleanup plan separately. No rollback needed for RAG-3F.

## Rollback Judgment

Rollback is not recommended.

RAG-3F produced a clear improvement from `14/20` to `18/20`, fixed all vendor-specific failures, preserved out-of-scope behavior, and did not create duplicate-title failures. The remaining issues are targeted quality/backlog items rather than import blockers.

Rollback remains available through the prepared RAG-3F rollback SQL, limited to rows tagged with `metadata.rag_gate = RAG-3F` or `chunk_id like 'rag3d_%'`. It should not be run unless separately approved.
