# RAG-3I Targeted Corpus Cleanup Plan

Date: 2026-05-05

## Scope

RAG-3I is a planning and read-only analysis step for the two remaining RAG-3H source-only failures:

- `kakao-price-discount`
- `gambling-policy`

This plan does not change RAG logic, DB schema, production environment, embeddings, crawler behavior, or existing RAG-3F rows.

## RAG-3H Failure Summary

RAG-3H improved source-only evaluation from `14/20` to `18/20`. The remaining failures are both `generic-policy` fixtures.

| Fixture | Current failure | Main issue |
| --- | --- | --- |
| `kakao-price-discount` | Expected keyword/hybrid, received vector | Generic price query falls to original Meta vector seed rows instead of price/discount policy rows |
| `gambling-policy` | Expected title hints mismatch | Retrieved keyword rows mention related terms but titles are weak/noisy and do not satisfy policy/title hints |

Vendor-specific fixtures now pass `10/10`, so the remaining issue is not broad multi-vendor coverage. It is targeted generic policy evidence quality.

## Fixture 1: `kakao-price-discount`

Question:

```text
광고 소재에 가격이나 할인율을 표시할 때 기준은?
```

Expected:

- `expectedVendor=ANY`
- source title hints include policy/guide terms
- required source terms include `가격`, `할인`
- retrieval method should include `keyword` or `hybrid`

### Current Final Sources

| Rank | Title | Vendor | Corpus | Retrieval | Key scores | Issue |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 인스타그램 광고 사양 | META | `ollama_document_chunks` | vector | vector 0.928, keyword 0, lexical 0.20 | Original Meta seed is semantically high but not price policy evidence |
| 2 | 페이스북 광고 정책 | META | `ollama_document_chunks` | vector | vector 0.913, keyword 0, lexical 0.20 | Same vector-only seed pattern |
| 3 | 메타 광고 정책 2024 | META | `ollama_document_chunks` | vector | vector 0.847, keyword 0, lexical 0.20 | Same vector-only seed pattern |

### Why RAG-3F Rows Did Not Rise

RAG-3D selected 11 `kakao-price-discount` candidate rows, including:

- KAKAO `제작 가이드` rows with `price|rights|spec`
- KAKAO `이미지 에디터` row with `price|event|spec`
- KAKAO `정산` row with `price|spec`
- GOOGLE and NAVER price-related rows
- META price-related supplemental rows

However, the fixture query is generic and has no explicit vendor. The current evidence gate allows original Meta seed rows to survive because:

- vector scores are very high on original six Meta seed rows
- keywordScore is `0`, but the source is still accepted as vector evidence
- lexical overlap is nonzero due broad terms like `광고` and `기준`
- no explicit vendor intent means no vendor mismatch penalty applies
- RAG-3F price rows likely need stronger title/content evidence or a query-specific candidate slot to beat vector-only seeds

### Data vs Fixture vs Logic Judgment

| Question | Judgment |
| --- | --- |
| Data 보강 필요? | Yes, but targeted: add or promote stronger price/discount policy chunks with title and content containing `가격`, `할인`, `할인율`, `표시`, `광고 소재` |
| Fixture 수정 필요? | Maybe. The fixture id says Kakao, but the question is generic and `expectedVendor=ANY`. Either keep generic and accept any strong policy source, or rewrite question to explicitly say Kakao if Kakao behavior is intended |
| RAG 로직 수정 필요? | Not first. Prefer data-only targeted sample and fixture clarification before more scoring changes |
| Rollback 필요? | No |

## Fixture 2: `gambling-policy`

Question:

```text
도박이나 사행성 표현은 광고에 쓸 수 있나요?
```

Expected:

- `expectedVendor=ANY`
- source title hints include `집행기준`, `정책`
- required source terms include `도박`, `사행`
- retrieval method should include `keyword` or `hybrid`

### Current Final Sources

| Rank | Title | Vendor | Corpus | Retrieval | Key scores | Issue |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 네이버 광고 가이드: 타겟팅 확대와 예산 조정으로 광고 성과 높이기광고운영팁4분 | inferred META | `document_chunks` | keyword | keyword 0.40, lexical 0.40 | Title is operational/tips content, not policy evidence; vendor inference is suspicious |
| 2 | 네이버 광고 가이드: 클린센터 | NAVER | `document_chunks` | keyword | keyword 0.40, lexical 0.40 | Potentially related, but title does not match expected hints |
| 3 | 네이버 광고 가이드: 클린센터 | NAVER | `document_chunks` | keyword | keyword 0.40, lexical 0.40 | Duplicate title pattern; title quality still weak |

### Why RAG-3F Rows Did Not Rise

RAG-3D selected 6 gambling-targeted candidates and several nearby gambling-topic rows, including:

- KAKAO `심사 가이드`
- KAKAO `상품가이드`
- KAKAO `제작 가이드`
- KAKAO `집행 가이드`
- NAVER FAQ/help rows
- META `Meta의 온라인 도박 및 게임 광고 정책 정보`

The current final sources still came from `document_chunks`, not RAG-3F `ollama_document_chunks`. Likely causes:

- the query has strong lexical terms `도박`, `사행`, so keyword rows from `document_chunks` can outrank vector-ready rows
- selected RAG-3F gambling candidates may contain broad review/spec content and only weak gambling context
- source titles like `클린센터` and operational guide titles are too generic for fixture title hints
- sourceVendor inference is brittle when title/content contains multiple platform terms or no canonical vendor metadata

### Data vs Fixture vs Logic Judgment

| Question | Judgment |
| --- | --- |
| Data 보강 필요? | Yes. Add a small set of high-quality gambling-specific rows with canonical titles like `광고 정책: 도박 및 사행성 표현` or platform-specific policy titles |
| Fixture 수정 필요? | Possibly. `expectedSourceTitle` may be too narrow if valid policy evidence title is `클린센터`; however the current top title quality is objectively weak, so corpus/title cleanup should come first |
| RAG 로직 수정 필요? | Not first. If targeted corpus still fails, add title-quality boost for `정책`, `운영정책`, `집행기준`, `심사 가이드` on generic policy fixtures |
| Rollback 필요? | No |

## Original Six Meta Seed Impact

The original six Meta seed rows remain useful for Meta-specific fixtures, but they are still too strong for some generic-policy queries:

- They have high vector scores.
- They lack URL linkage, producing `missing_url` warnings.
- They can pass generic evidence gates when lexical overlap is weak but nonzero.

RAG-3I should not delete or rollback these rows. They support Meta fixture stability. Instead, RAG-3J should make targeted generic policy candidates strong enough to compete, or later RAG logic can penalize vector-only sources for generic policy questions when keyword/hybrid candidates exist.

## RAG-3J Data-only Candidate Proposal

Proceed with a small data-only extension rather than rollback or RAG logic changes.

Recommended new sample size:

- 20 to 30 rows total
- `price/discount`: 10 to 15 rows
- `gambling/speculative`: 10 to 15 rows

Selection criteria:

- source content must contain the exact fixture terms:
  - price: `가격`, `할인`, `할인율`, `표시`
  - gambling: `도박`, `사행`, `사행성`
- title or canonical title should contain at least one of:
  - `정책`
  - `운영정책`
  - `집행기준`
  - `심사 가이드`
  - `광고등록기준`
- prefer rows with recoverable `source_url`
- avoid operational tips, campaign optimization articles, FAQ-only titles, navigation/footer chunks
- avoid rows where only metadata/topic heuristic matched but content lacks exact policy terms
- copy existing `document_chunks.embedding`; no reembedding
- tag metadata with `rag_gate=RAG-3J`

Recommended vendor balance:

| Target | Suggested rows | Notes |
| --- | ---: | --- |
| KAKAO price/discount | 5-8 | If fixture remains generic, still useful as Korean policy evidence |
| NAVER price/discount | 2-4 | Add only if title is policy-grade |
| GOOGLE price/discount | 2-4 | Use policy/help pages, avoid campaign setup pages |
| META price/discount | 1-3 | Prefer actual pricing/commerce policy over seed specs |
| Generic/KAKAO gambling | 4-6 | Strong policy text only |
| NAVER gambling/clean-center | 2-4 | Normalize canonical title if content is truly policy |
| META gambling | 2-3 | `온라인 도박 및 게임 광고 정책` is likely a strong candidate |
| GOOGLE gambling | 1-3 | Use only if explicit policy text exists |

## Fixture Adjustment Proposal

Do not adjust fixtures before RAG-3J, except document the ambiguity:

- `kakao-price-discount` has a Kakao-oriented id but a generic question and `expectedVendor=ANY`.
- If the goal is Kakao-specific retrieval, rewrite the question to `카카오 광고 소재에 가격이나 할인율을 표시할 때 기준은?`.
- If the goal is generic Korean policy retrieval, keep `expectedVendor=ANY` and judge by source terms/title quality.

For `gambling-policy`, keep the fixture unchanged for now. The current failure is a useful signal that source titles are not policy-grade enough.

## RAG Logic Adjustment Backlog

Hold off on RAG logic changes until targeted data-only cleanup is measured.

Potential later changes if RAG-3J is insufficient:

1. For generic-policy fixtures, demote vector-only sources when keyword/hybrid policy candidates exist.
2. Add title-quality boost for policy-grade terms.
3. Add exact-term coverage boost for query critical terms.
4. Penalize original seed rows with `missing_url` and no keywordScore for non-Meta generic policy questions.
5. Improve source vendor inference with metadata-first rules.

## Rollback Judgment

Rollback is not needed.

RAG-3F improved the suite and fixed all vendor-specific failures. RAG-3I should be handled as a targeted additive cleanup. Existing RAG-3F rows should remain.

## Recommended Next Approval

```text
Gate RAG-3J targeted data-only candidate generator를 승인한다.

목표:
- kakao-price-discount와 gambling-policy 실패를 대상으로 SELECT-only 후보를 추출한다.
- price/discount 10-15개, gambling 10-15개 후보를 선별한다.
- INSERT는 아직 실행하지 않는다.
- embedding은 기존 document_chunks.embedding 복사 가능성만 검증한다.
- RAG 로직, DB schema, production env, crawler, reembedding은 변경하지 않는다.
```
