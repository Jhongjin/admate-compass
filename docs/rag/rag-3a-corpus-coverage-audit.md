# RAG-3A Corpus Coverage Audit

Date: 2026-05-05

Scope: read-only audit of Admate-Vision `compass` corpus coverage. No DB schema, data import, reembedding, crawler, RAG logic, production env, or data changes were executed.

Note: vendor classification is a heuristic text scan across ids, titles, content, and metadata. One row can match more than one vendor, so vendor row counts are multi-label counts and may exceed table totals.

## Vendor Coverage

| Table | Total | KAKAO | NAVER | GOOGLE | META | UNKNOWN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `compass.documents` | 4,969 | 509 | 1,006 | 2,573 | 783 | 213 |
| `compass.document_chunks` | 38,973 | 3,141 | 4,545 | 12,103 | 10,683 | 8,656 |
| `compass.ollama_document_chunks` | 6 | 0 | 0 | 0 | 6 | 0 |

## Metadata Quality

| Table | Total | title present | URL present | metadata.source_url | metadata.document_url |
| --- | ---: | ---: | ---: | ---: | ---: |
| `compass.documents` | 4,969 | 4,969 | 4,962 | 0 | 0 |
| `compass.document_chunks` | 38,973 | 38,973 | 0 | 0 | 0 |
| `compass.ollama_document_chunks` | 6 | 6 | 0 | 0 | 0 |

Key metadata finding:

- `documents` has strong title and direct URL coverage.
- `document_chunks` has title coverage but no direct source URL metadata at chunk level.
- `ollama_document_chunks` has only 6 Meta rows and no source URL metadata.

## Failed Fixture Term Scan

Candidate count means rows containing all scan terms for the fixture. This is not a ranking result, only corpus existence.

### `compass.documents`

| Fixture | Candidate count | Sample titles |
| --- | ---: | --- |
| `kakao-review-standards` | 135 | 제작 가이드; 이용기관 등록; 제한 업종; 가입하기; 계정 관리; 소재 만들기; 모션 비즈보드; 커스텀 비즈보드 |
| `kakao-youth-harmful-content` | 32 | 메시지 등록; 제작 가이드; 집행 기준 및 준수사항; 업종별 가이드; 집행 가이드; 제한 업종; 업종/소재 구성 가이드; 집행기준 및 준수사항 |
| `kakao-price-discount` | 120 | 동적 리마케팅용 디스플레이 광고 만들기; Google TV 마스트헤드; 쇼핑 캠페인 모니터링 및 최적화하기; 텍스트 광고 소개; 효과적인 광고 설정하기; 할인 혜택 실적 측정하기; 효과적인 텍스트 광고 작성; 여행 프로모션 광고에 대한 정보 |
| `kakao-kakao-service-protection` | 39 | 제작 가이드; 이용기관 등록; 계정 관리; 모션 비즈보드; 커스텀 비즈보드; 집행 기준 및 준수사항; 집행 가이드; 집행기준 및 준수사항 |
| `google-ads-policy` | 479 | 구조화된 스니펫 확장 소재에 대한 정보; 전환 측정에 대한 정보; 전환 가치 규칙 정보; 오프라인 전환 가져오기를 리드 확보용 향상된 전환으로 업그레이드하기; 관리자 계정(MCC): 관리자 계정에서 새 Google Ads 계정 만들기; 동적 리마케팅용 디스플레이 광고 만들기; 동영상 광고용 양방향 기능 소개; 관련 동영상 사용하기 |
| `gambling-policy` | 22 | 제작 가이드; Naver FAQ URL title; 집행 기준 및 준수사항; 제한업종; 집행 가이드; 업종별 가이드; 제한 업종 |

### `compass.document_chunks`

| Fixture | Candidate count | Sample titles |
| --- | ---: | --- |
| `kakao-review-standards` | 169 | 심사 가이드; 집행 기준 및 준수사항; 업종별 가이드; 제한업종; 계정 관리; 소재 만들기; 모션 비즈보드; 제작 가이드 |
| `kakao-youth-harmful-content` | 27 | 집행 기준 및 준수사항; 업종별 가이드; 집행 가이드; 업종/소재 구성 가이드; 집행기준 및 준수사항; 업종 기준 및 준수사항; 광고 차단/신고 안내; 채널 정보 등록 |
| `kakao-price-discount` | 178 | 다양한 쇼핑 지면을 통해 고객 유입과 브랜딩을 극대화할 수 있는; Google TV 마스트헤드; 쇼핑 캠페인 모니터링 및 최적화하기; 할인 혜택 실적 측정하기; 효과적인 텍스트 광고 작성; 차량 '가격 인하' 주석에 대한 정보; 반응형 디스플레이 광고를 위한 권장사항 가이드; 효과적인 디스플레이 광고를 만들기 위한 도움말 |
| `kakao-kakao-service-protection` | 29 | 집행 기준 및 준수사항; 제작 가이드; 모션 비즈보드; 커스텀 비즈보드; 집행 가이드; 집행기준 및 준수사항; 업종 기준 및 준수사항; 카카오톡 브랜드스토어 |
| `google-ads-policy` | 817 | 관리자 계정(MCC): 관리자 계정에서 새 Google Ads 계정 만들기; 동영상 광고용 양방향 기능 소개; 관련 동영상 사용하기; 동영상 광고로 제품 홍보하기; 고객 매치 타겟팅 일치율에 대한 정보; 첫 번째 광고 찾기; 호텔 광고를 위한 입찰 개요; Google 잠재고객 솔루션 업데이트 |
| `gambling-policy` | 27 | 운영정책; Naver FAQ URL title; 집행 기준 및 준수사항; 제한업종; 제작 가이드; 집행 가이드; 업종별 가이드; 제한 업종 |

### `compass.ollama_document_chunks`

| Fixture | Candidate count |
| --- | ---: |
| `kakao-review-standards` | 0 |
| `kakao-youth-harmful-content` | 0 |
| `kakao-price-discount` | 0 |
| `kakao-kakao-service-protection` | 0 |
| `google-ads-policy` | 0 |
| `gambling-policy` | 0 |

## Corpus Existence Findings

- Kakao documents exist in both `documents` and `document_chunks`.
- Naver documents exist in both `documents` and `document_chunks`.
- Google documents exist in both `documents` and `document_chunks`, though many candidates look like Google Ads help/operation docs rather than clean policy docs.
- Meta documents exist in all three corpora, and `ollama_document_chunks` is currently Meta-only.
- The largest gap is not absence from `document_chunks`; it is absence from `ollama_document_chunks`, which is the vector-ready chat corpus.

## Remaining 6 Source-only Failures: Cause Estimate

| Fixture | Cause estimate |
| --- | --- |
| `kakao-review-standards` | Relevant Kakao material exists in `document_chunks`, but no Kakao vector-ready `ollama_document_chunks`; Meta vector seed can still win. |
| `kakao-youth-harmful-content` | Relevant Kakao chunks exist, but canonical title/source family is weak; expected title hints do not always match top chunks. |
| `kakao-price-discount` | Price/discount chunks exist but are cross-vendor and broad. Current final method can be vector-only Meta, indicating missing vector-ready generic policy chunks. |
| `kakao-kakao-service-protection` | Candidate rows exist in `document_chunks`, but not in `ollama_document_chunks`; selected evidence can become empty after evidence gate. |
| `google-ads-policy` | Many Google rows exist, but clean policy chunks are not represented in `ollama_document_chunks`; Google help docs may be operational rather than policy-specific. |
| `gambling-policy` | Policy terms exist in `document_chunks`, but title/source hints are inconsistent and chunk-level URL metadata is missing. |

## RAG-3B Data-only Expansion Feasibility

RAG-3B can be done without schema changes if it only inserts additional rows into `compass.ollama_document_chunks` derived from existing `compass.document_chunks`.

Recommended approach:

1. SELECT-only candidate generator:
   - choose high-quality candidates from `document_chunks`
   - exclude noisy/navigation-heavy chunks
   - require title, excerpt length, vendor/topic terms
   - preserve `source_document_id` and `source_chunk_id` in metadata
2. Small sample import first:
   - 10-20 rows per vendor/topic family
   - include Kakao review/youth/service protection, Google policy, generic price/discount, gambling
3. Keep vector dimension 1024.
4. Use existing embedding strategy only if approved.
5. Verify with source-only fixtures before any broad import.

## `ollama_document_chunks` Regeneration Plan

Recommended target coverage for a first balanced corpus:

| Vendor/family | Initial rows |
| --- | ---: |
| Kakao policy/review | 40-80 |
| Naver policy/help | 30-60 |
| Google Ads policy/help | 40-80 |
| Meta/Facebook/Instagram | keep existing 6, later expand to 30-60 |
| Generic policy topics | 40-80 |

Metadata to include in new rows:

- `source_vendor`
- `canonical_title`
- `original_title`
- `source_document_id`
- `source_chunk_id`
- `chunk_topic`
- `source_url` when recoverable from parent `documents`
- `embedding_dimension`
- `embedding_model`

## Crawler / Chunking Improvements

Not for RAG-3A/B execution, but recommended backlog:

- Build canonical policy URL inventory for Kakao, Naver, Google, Meta.
- Strip navigation, sidebar, app payload, and FAQ chrome before chunking.
- Propagate parent `documents.document_url/url` into chunk metadata.
- Normalize source titles at crawl/chunk time.
- Add vendor/topic labels during chunk creation.
- Create compact vector-ready chunks separate from raw archive chunks.

## Risks

- `document_chunks` has broad coverage but mixed quality; blindly promoting chunks into `ollama_document_chunks` can worsen retrieval.
- Chunk-level URLs are missing, so citations may remain weak unless parent document URL is carried forward.
- Google corpus appears broad but not necessarily policy-specific.
- Vendor classifier is heuristic; rows can be multi-label or mislabeled.
- Data-only import still needs strict row limits and rollback SQL.

## Read-only SQL Used / Approved Shape

The audit can also be reproduced in SQL Editor with the following SELECT-only patterns:

```sql
-- Vendor coverage shape: classify documents, document_chunks, and ollama_document_chunks
-- by scanning title/content/metadata/document_id/chunk_id for vendor terms.
-- No write operation is required.
```

```sql
-- Metadata quality shape: count title presence, URL presence,
-- metadata.source_url, and metadata.document_url for each corpus table.
-- No write operation is required.
```

```sql
-- Fixture term scan shape: for each failing fixture, count chunks
-- containing all fixture terms and aggregate sample titles.
-- No write operation is required.
```

## Next Approval Wording

Approve Gate RAG-3B data-only `ollama_document_chunks` candidate generator:

- Use SELECT-only first to generate candidate rows from existing `compass.document_chunks`.
- Target only the six failing source-only fixture families and multi-vendor balance.
- Do not execute INSERT yet.
- Do not change schema, crawler, RAG logic, production env, or existing imported data.
- Report candidate counts, sample titles, metadata quality, and proposed capped import size before any write.
