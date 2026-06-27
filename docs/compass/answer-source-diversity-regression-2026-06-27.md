# Compass Answer Source Diversity Regression

Date: 2026-06-27

Purpose: lock the regex expansion and source-diversity behavior that moved the Naver shopping DB answer from a narrow S1-only procedure answer to a multi-source operational answer.

## Production Flag Approval Record

`COMPASS_ANSWER_SOURCE_RELAXATION=medium` is approved for production as a conditional post-hoc ratification.

- This was not a prior-approved production flag change. It is recorded as a post-hoc approval after production verification showed the flag is now contributing to cited-source diversity.
- The original hold condition no longer applies: before the regex expansion, `medium` added candidates without increasing cited evidence; after the regex expansion, medium evidence enters the answer body and citations.
- Rolling the flag back would reduce the Naver shopping DB answer from the current multi-source cited answer toward the earlier S1-heavy answer.
- Future production flag changes must follow this order: preview measurement, commander/audit approval, then production change.
- This approval does not authorize `ollama_document_chunks` removal, `COMPASS_SEARCH_SOURCE` default switching, or fixture rewriting.

## Measured Questions

| Question | Mode | Before answerSources | Before cited | Before score | After answerSources | After cited | After score | Required behavior |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | document_chunks + medium | 2 | 2 | 82 | 4 | 4 | 76 | Must include the data-quality/update bullet and a real procedure alternate source citing non-S1 evidence. |
| 네이버 쇼핑검색광고는 어떤 상품이야? | document_chunks + medium | 4 | 4 | 82 | 4 | 4 | 82 | Must keep four cited sources and not regress to a single-source answer. |
| 카카오 비즈보드는 어떤 상품이야? | document_chunks + medium | 2 | 2 | 82 | 2 | 2 | 82 | Must not include Naver shopping DB data-quality wording. |
| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | document_chunks + medium | 3 | 3 | 82 | 3 | 3 | 82 | Must not include Naver shopping DB data-quality wording. |

## Regression Rules

- The Naver shopping DB structured answer must recognize `가격정보`, `배송정보`, `상품정보 수정`, `광고 노출용 상품명`, `광고 노출용.*이미지`, and `EP정보 수정`.
- The Naver shopping DB answer must add a distinct `상품 데이터 품질 확인` section when those update/data-quality sources are present.
- Medium Naver shopping data evidence may be included only for `db_setup` + Naver shopping data intent.
- Low-priority item-set/product-ID/filter utility sources must not be promoted to strong evidence.
- Medium sources with useful data-quality/update evidence must be ranked before low-priority utility sources.
- The audited procedure alternate chunk `doc_1774317605538_kkuzirx_chunk_3` must be available as an official snapshot supplement and may be injected only for Naver shopping DB setup answers.
- Fast structured Naver shopping DB answers must re-run the four-source DB selector after procedure-alternate supplementation so the answer keeps `answerSources=4` instead of appending a fifth source.
- Kakao Bizboard product and creative answers must not inherit Naver shopping DB data-quality wording.

## Current Preview Verification Snapshot

Preview deployment: `https://admate-compass-hiw4c4zow-jeonhongjins-projects.vercel.app`

Note: the shopping DB score is `76` because the self-assessor applied the existing `retrieval_limited` penalty for a timed-out supplemental retrieval channel. The answer itself used all four answer sources (`citationUseRate=1.0`) and met the source-diversity target.

| Question | raw | merged | verified | strict | answerSources | cited | score | firstCorpus |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | 23 | 17 | 17 | 6 | 4 | 4 | 76 | document_chunks |
| 네이버 쇼핑검색광고는 어떤 상품이야? | 24 | 13 | 13 | 7 | 4 | 4 | 82 | document_chunks |
| 카카오 비즈보드는 어떤 상품이야? | 4 | 4 | 4 | 2 | 2 | 2 | 82 | document_chunks |
| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | 3 | 3 | 3 | 3 | 3 | 3 | 82 | document_chunks |

## Dominance Recheck

Method: preview API with cache bypass, `COMPASS_ANSWER_SOURCE_RELAXATION=medium`, counting citation-bearing claim lines and excluding the final `근거:` source-summary line.

Threshold: flag questions where the top cited source exceeds 70% of citation-bearing claim units. Penalty candidates also require `answerSources >= 3` and `cited >= 3`; source-limited two-source answers are measured but not treated as penalty candidates.

| Question | answerSources | cited | Citation claim units | Top source | Top units | Top share | Over 70% | Penalty candidate |
|---|---:|---:|---:|---|---:|---:|---|---|
| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | 4 | 4 | 7 | S1 | 3 | 42.9% | no | no |
| 네이버 쇼핑검색광고는 어떤 상품이야? | 4 | 4 | 4 | S1 | 1 | 25.0% | no | no |
| 카카오 비즈보드는 어떤 상품이야? | 2 | 2 | 4 | S1 | 3 | 75.0% | yes | no, source-limited |
| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | 3 | 3 | 3 | S1 | 1 | 33.3% | no | no |

Conclusion: no true global dominance penalty candidate remains. The earlier Naver shopping DB candidate dropped from 71.4% S1 share to 42.9% after the targeted procedure-alternate source selection. Do not add a global dominance penalty.

## Shopping DB Procedure Evidence Investigation

Question: can the five S1 procedure bullets be distributed to other real corpus chunks, or must they be compressed because S1 is the only source?

Finding: distribution is possible, but it should be targeted. The same original FAQ has adjacent chunks (`doc_1773710116296_uawf5xm_chunk_0`, `doc_1773710116296_uawf5xm_chunk_1`) that cover parts of the procedure, but those are the same public source as S1 (`https://ads.naver.com/help/faq/875`) and should not be used just to create cosmetic diversity. Separate FAQ chunks exist for several procedure steps.

| Signal | S1 currently covers | Separate corpus candidates | Design implication |
|---|---|---|---|
| registration / DB URL or EP input | yes | `doc_1774317605538_kkuzirx_chunk_3`, `doc_1774317545866_m90zzej_chunk_5` | Keep S1 or cite a separate setup/inspection FAQ when selected. |
| review time / inspection delay | yes | `doc_1774317605538_kkuzirx_chunk_3` | Good distribution candidate for the review-time bullet. |
| unserved product list | yes | `doc_1774317605538_kkuzirx_chunk_3`, `doc_1774317605315_4oetjya_chunk_1` | Good distribution candidate for the post-review product-list bullet. |
| category matching | yes | `doc_1774317605315_4oetjya_chunk_1` | Good distribution candidate for category matching if selected. |
| service ready / price-comparison exposure | yes | `doc_1774317545866_m90zzej_chunk_5` | Good distribution candidate for service-ready / shopping-search usability. |

Implemented design: do not add a global source-dominance penalty. For the Naver shopping DB structured path, prefer one useful procedure alternate source over an unused duplicate data-quality source when `answerSources` is capped at four. The first target is `doc_1774317605538_kkuzirx_chunk_3`, which now appears as a cited source and carries the registration/unserved-list procedure bullets. The remaining S1 procedure bullets stay on S1 because they are still source-supported and the top-source share is below the 70% threshold.

## Backlog

- Dominance track status: closed. Shopping DB dominance was locally resolved (`S1` share `71.4%` -> `42.9%`), `doc_1774317605538_kkuzirx_chunk_3` is cited as `S2`, `answerSources=4` is preserved, and `citationUseRate=1.0`.
- Global source-dominance penalty: do not implement. The remaining measured high-share case is the two-source Kakao Bizboard explanation, which is source-limited and should not be penalized.
- New backlog item: the shopping DB score of `76` is a byproduct of the existing `retrieval_limited` self-assessment penalty. Because the answer had rich verified evidence (`verified=17`) and used all four answer sources, the retrieval-limited scoring rule may need a future review after the `document_chunks` search transition.
- Do not change the `retrieval_limited` rule in this phase. Record only; discuss any self-assessment scoring adjustment separately.
- Still on hold without separate approval: `ollama_document_chunks` removal, `COMPASS_SEARCH_SOURCE` default switching, and fixture rewriting.
