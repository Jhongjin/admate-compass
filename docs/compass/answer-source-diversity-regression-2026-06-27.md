# Compass Answer Source Diversity Regression

Date: 2026-06-27

Purpose: lock the regex expansion and source-diversity behavior that moved the Naver shopping DB answer from a narrow S1-only procedure answer to a multi-source operational answer.

## Measured Questions

| Question | Mode | Before answerSources | Before cited | Before score | After answerSources | After cited | After score | Required behavior |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | document_chunks + medium | 2 | 2 | 82 | 4 | 3 | 82 | Must include the data-quality/update bullet citing non-S1 evidence. |
| 네이버 쇼핑검색광고는 어떤 상품이야? | document_chunks + medium | 4 | 4 | 82 | 4 | 4 | 82 | Must keep four cited sources and not regress to a single-source answer. |
| 카카오 비즈보드는 어떤 상품이야? | document_chunks + medium | 2 | 2 | 82 | 2 | 2 | 82 | Must not include Naver shopping DB data-quality wording. |
| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | document_chunks + medium | 3 | 3 | 82 | 3 | 3 | 82 | Must not include Naver shopping DB data-quality wording. |

## Regression Rules

- The Naver shopping DB structured answer must recognize `가격정보`, `배송정보`, `상품정보 수정`, `광고 노출용 상품명`, `광고 노출용.*이미지`, and `EP정보 수정`.
- The Naver shopping DB answer must add a distinct `상품 데이터 품질 확인` section when those update/data-quality sources are present.
- Medium Naver shopping data evidence may be included only for `db_setup` + Naver shopping data intent.
- Low-priority item-set/product-ID/filter utility sources must not be promoted to strong evidence.
- Medium sources with useful data-quality/update evidence must be ranked before low-priority utility sources.
- Kakao Bizboard product and creative answers must not inherit Naver shopping DB data-quality wording.

## Current Production Verification Snapshot

Production alias: `https://compass.admate.ai.kr`

| Question | raw | verified | strict | answerSources | cited | firstCorpus |
|---|---:|---:|---:|---:|---:|---|
| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | 24 | 15 | 5 | 4 | 3 | document_chunks |
| 네이버 쇼핑검색광고는 어떤 상품이야? | 24 | 14 | 7 | 4 | 4 | document_chunks |
| 카카오 비즈보드는 어떤 상품이야? | 4 | 4 | 2 | 2 | 2 | document_chunks |
| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | 3 | 3 | 3 | 3 | 3 | document_chunks |

