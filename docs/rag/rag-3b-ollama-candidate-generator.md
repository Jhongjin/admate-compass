# RAG-3B Ollama Candidate Generator

Date: 2026-05-05

Scope: prepare a SELECT-only candidate generator for future `compass.ollama_document_chunks` expansion. No insert, update, delete, truncate, drop, alter, reembedding, crawler, RAG logic, production env, DB schema, or data change was executed.

## Candidate Generator SQL

File:

- `docs/sql/2026-05-05_rag3b_ollama_candidate_generator.sql`

The SQL reads from:

- `compass.document_chunks`
- `compass.documents`

The SQL outputs candidate rows only. It does not write to `compass.ollama_document_chunks`.

## Candidate Selection Strategy

The generator scores raw `document_chunks` rows for future vector-ready promotion.

Quality score features:

| Feature | Effect |
| --- | --- |
| title exists | boost |
| parent/source URL recoverable | boost |
| vendor term exists | boost |
| topic term exists | boost |
| failing fixture term match | strong boost |
| content length 250-1800 chars | boost |
| content length outside 80-2400 chars | penalty/exclusion |
| noisy payload/navigation pattern | heavy penalty/exclusion |

Vendor labels:

- `KAKAO`
- `NAVER`
- `GOOGLE`
- `META`

Topic labels:

- `review`
- `youth`
- `false_claim`
- `price`
- `event`
- `rights`
- `hate`
- `gambling`
- `spec`

Fixture target labels:

- `kakao-review-standards`
- `kakao-youth-harmful-content`
- `kakao-price-discount`
- `kakao-kakao-service-protection`
- `google-ads-policy`
- `gambling-policy`

## Noisy Pattern Exclusions

Rows are excluded or heavily penalized when they look like:

- JavaScript/app payloads
- Next.js/webpack artifacts
- headers/footers/navigation
- login/signup chrome
- cookie text
- breadcrumb text
- "Was this helpful" / "Last updated" boilerplate

The goal is to keep candidate rows closer to policy evidence, not page chrome.

## Deduplication

Dedupe criteria:

1. `source_vendor + content_fingerprint`
   - fingerprint is generated from normalized leading content.
2. `source_vendor + document_id + chunk_id`
   - prevents duplicate rows for the same source chunk.
3. final output uses `distinct on (source_vendor, content_fingerprint)`.

This keeps repeated page chrome or duplicate chunk exports from flooding the candidate set.

## Proposed Metadata Normalization

Future insert metadata should include:

- `source_vendor`
- `canonical_title`
- `original_title`
- `source_document_id`
- `source_chunk_id`
- `source_url`
- `topic_labels`
- `fixture_matches`
- `candidate_quality_score`
- `candidate_generated_at`

Canonical title mapping:

| Vendor | Canonical title |
| --- | --- |
| `KAKAO` | `카카오 광고 심사 가이드` |
| `NAVER` | `네이버 광고 가이드` |
| `GOOGLE` | `Google Ads 가이드` |
| `META` | `Meta 광고 정책` |

## Local Read-only Candidate Summary

The SQL caps output at 200 rows. A local read-only scan using equivalent criteria produced a 222-row pre-cap candidate pool:

| Metric | Count |
| --- | ---: |
| eligible scored candidates | 13,440 |
| deduped candidates | 10,422 |
| selected pre-cap pool | 222 |
| SQL output cap | 200 |

Vendor distribution in the pre-cap pool:

| Vendor | Candidate count |
| --- | ---: |
| `KAKAO` | 64 |
| `NAVER` | 50 |
| `GOOGLE` | 58 |
| `META` | 50 |

Fixture coverage in the pre-cap pool:

| Fixture | Candidate count |
| --- | ---: |
| `kakao-review-standards` | 29 |
| `kakao-youth-harmful-content` | 20 |
| `kakao-price-discount` | 29 |
| `kakao-kakao-service-protection` | 20 |
| `google-ads-policy` | 46 |
| `gambling-policy` | 6 |

Sample titles by vendor:

| Vendor | Sample titles |
| --- | --- |
| `KAKAO` | 심사 가이드; 집행 기준 및 준수사항; 알림톡 심사 가이드; 상품가이드; 집행기준 및 준수사항; 집행 가이드; 윤리 정책; 제작 가이드 |
| `NAVER` | Naver FAQ URL title; 다양한 쇼핑 지면을 통해 고객 유입과 브랜딩을 극대화할 수 있는; 운영정책; 이용약관; 클린센터; 광고 등록 기준 |
| `GOOGLE` | 고급 인증 관련 정책; 다양한 유형의 앱 캠페인에 대한 정보; 쇼핑 광고 정책; 검색 캠페인의 이미지 확장 소재에 대한 정보; 비승인 광고 수정 또는 정책 결정에 대한 이의신청; 고객 데이터 정책; Google TV 마스트헤드; YouTube CPM 마스트헤드 캠페인 만들기 |
| `META` | Meta Verified 비즈니스 구독의 자격 요건; Game Payments; 비즈니스용 Meta Verified 정보; Facebook 검색 결과의 참여 슬라이드 광고 사양; Meta 광고 노출 위치 관련 세금; Meta 플랫폼 약관 |

## Quality Interpretation

The candidate generator finds useful Kakao and Google policy candidates that are currently absent from `ollama_document_chunks`.

However, the candidate pool is still mixed:

- Google candidates include both policy and operational/help content.
- Naver candidates include some URL-title rows and operational tips.
- Meta candidates include business support and spec pages, not only ad policy.
- Kakao candidates look stronger for the six failing fixtures than the current `ollama_document_chunks` corpus.

This means RAG-3C should import a small, curated sample rather than all 200 candidates.

## Recommended RAG-3C Sample Size

Recommended first sample import size:

| Family | Rows |
| --- | ---: |
| Kakao review/youth/service protection | 30 |
| Google policy/help-policy | 20 |
| Generic price/discount/gambling | 20 |
| Naver policy/help-policy | 10 |
| Meta balanced supplement | 10 |
| Total | 90 |

Hard cap recommendation: 100 rows.

Rationale:

- Keeps rollback simple.
- Avoids noisy corpus flooding.
- Gives source-only fixtures enough vector-ready non-Meta evidence.
- Preserves current 6 Meta seed rows for continuity.

## RAG-3C Should Still Be Two-step

1. Generate candidate CSV from SQL.
2. Review sample titles and metadata summary.
3. Only after approval, generate target INSERT SQL for capped sample import.

RAG-3C should not directly import all generated candidates.

## Risks

- Candidate quality is heuristic and still needs human review.
- Some Google/Naver rows are help/operation docs rather than policy docs.
- Chunk-level URLs are recovered from parent `documents` where possible but may still be weak.
- Future embedding generation must preserve vector(1024) compatibility.
- Too many generic candidates could reduce precision if imported at once.

## Next Approval Wording

Approve Gate RAG-3C candidate CSV export:

- Run `docs/sql/2026-05-05_rag3b_ollama_candidate_generator.sql` in Admate-Vision SQL Editor.
- Export the SELECT-only result to CSV.
- Do not execute INSERT or reembedding.
- Report exported row count, vendor distribution, fixture coverage, sample titles, and file path.
