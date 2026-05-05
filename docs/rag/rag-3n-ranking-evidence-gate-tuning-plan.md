# RAG-3N Generic Policy Ranking / Evidence Gate Tuning Plan

Date: 2026-05-05

## Scope

RAG-3N is a design-only step. It analyzes the two remaining RAG-3M source-only failures and proposes ranking/evidence-gate changes.

No RAG logic, DB schema, data import, reembedding, crawler, production environment, or rollback action is changed in this step.

## Current State

RAG-3K imported 30 targeted rows into `compass.ollama_document_chunks`.

Import and DB health are good:

- total `ollama_document_chunks`: 126
- RAG-3K rows: 30
- RAG-3F rows: 90
- original rows: 6
- RAG-3K embedding non-null: 30
- RAG-3K vector dim: 1024/1024
- RPC self-match: 5

But RAG-3M evaluation stayed at `18/20`.

Remaining failures:

- `kakao-price-discount`
- `gambling-policy`

RAG-3K final source usage in the 20-fixture diagnostic run:

- RAG-3K final sources: 0
- RAG-3F final sources: 11

This means the corpus now contains targeted candidates, but the ranking/evidence gate does not surface them.

## Failure 1: `kakao-price-discount`

Question:

```text
광고 소재에 가격이나 할인율을 표시할 때 기준은?
```

Failure:

```text
expected one of retrieval methods keyword, hybrid, received vector
```

Final sources:

| Rank | Title | Vendor | Corpus | Method | vectorScore | keywordScore | lexicalOverlap | Issue |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | 인스타그램 광고 사양 | META | `ollama_document_chunks` | vector | 0.928 | 0 | 0.20 | vector-only Meta seed |
| 2 | 페이스북 광고 정책 | META | `ollama_document_chunks` | vector | 0.913 | 0 | 0.20 | vector-only Meta seed |
| 3 | 메타 광고 정책 2024 | META | `ollama_document_chunks` | vector | 0.847 | 0 | 0.20 | vector-only Meta seed |

### Root Cause

The query is `generic-policy` and `expectedVendor=ANY`, so vendor mismatch rules do not reject Meta. The original six Meta seed rows have very strong vector scores. Because lexical overlap is `0.20`, they pass the current `isVerifiedEvidence` vector rule:

```text
vectorScore >= 0.82 && lexicalOverlap >= 0.12
```

They then outrank targeted price/discount rows even though they have:

- `keywordScore=0`
- `retrievalMethod=vector`
- `missing_url`
- weak exact topic evidence for `가격/할인/할인율`

### Required Tuning

For generic policy queries with explicit topic intent, vector-only sources should not dominate when topic-exact keyword/hybrid candidates exist.

## Failure 2: `gambling-policy`

Question:

```text
도박이나 사행성 표현은 광고에 쓸 수 있나요?
```

Failure:

```text
sources do not match expected title hints
```

Final sources:

| Rank | Title | Vendor | Corpus | Method | keywordScore | lexicalOverlap | Issue |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| 1 | 네이버 광고 가이드: 타겟팅 확대와 예산 조정으로 광고 성과 높이기광고운영팁4분 | inferred META | `document_chunks` | keyword | 0.40 | 0.40 | weak title, wrong-seeming vendor |
| 2 | 네이버 광고 가이드: 클린센터 | NAVER | `document_chunks` | keyword | 0.40 | 0.40 | title not enough for fixture |
| 3 | 네이버 광고 가이드: 클린센터 | NAVER | `document_chunks` | keyword | 0.40 | 0.40 | duplicate title pattern |

### Root Cause

The current keyword path can surface `document_chunks` with decent lexical overlap, but it does not sufficiently reward policy-grade titles or exact topic coverage over broad operational/help rows.

RAG-3K gambling rows exist in `ollama_document_chunks`, but they do not receive a rescue slot because the existing rescue logic only targets explicit KAKAO/NAVER/GOOGLE vendor intent. This fixture is generic (`expectedVendor=ANY`) and therefore receives no topic-specific rescue.

### Required Tuning

Generic policy queries need a topic-specific rescue slot, independent of vendor intent, when candidates have:

- exact topic terms
- policy-grade title/canonical title
- non-fallback source
- acceptable lexical/keyword evidence

## Current Code Areas

Primary file:

- `src/lib/services/RAGSearchService.ts`

Likely functions:

| Function | Why it matters |
| --- | --- |
| `normalizeSearchResult` | Computes vectorScore, keywordScore, lexicalOverlap, topicMatch, sourceQuality, hybridScore |
| `calculateKeywordScore` | Does not currently weight exact topic terms separately from generic keywords |
| `calculateHybridScore` | Current vector weight and vector-only acceptance still let original seed rows dominate |
| `isVerifiedEvidence` | Allows high-vector + low lexical vector-only evidence |
| `mergeDedupeAndRankCandidates` | Applies final sorting and rescue insertion |
| `isTargetVendorRescueCandidate` | Vendor-only rescue; no generic-topic rescue |
| `buildRankReason` | Should expose new tuning reasons in diagnostics |
| `buildSourceQuality` | Can carry title/url penalties, but does not know policy-grade title |

Potential evaluation file:

- `scripts/evaluate-rag-fixtures.mjs`

Only if diagnostics need new fields. Not required for first implementation unless new fields are added to source metadata.

## Proposed Tuning Design

### 1. Add Generic Policy Intent Helpers

Add helper methods:

```ts
private isGenericPolicyIntent(intent: QueryIntent): boolean
private hasPriceIntent(intent: QueryIntent): boolean
private hasGamblingIntent(intent: QueryIntent): boolean
private hasCriticalTopicTerms(candidate: SearchResult, intent: QueryIntent): boolean
private hasPolicyGradeTitle(candidate: SearchResult): boolean
private isOriginalMetaSeed(candidate: SearchResult): boolean
```

Generic policy intent can be inferred from:

- no explicit vendor intent
- topic intent includes `price`, `gambling`, `false_claim`, `rights`, `hate`, `event`, or `youth`
- query includes advertising/policy terms
- not out-of-scope

### 2. Exact Topic Match Boost

Add a deterministic topic exact match score separate from generic `topicMatch`.

Examples:

| Topic | Exact terms |
| --- | --- |
| price | `가격`, `할인`, `할인율`, `표시`, `소재` |
| gambling | `도박`, `사행`, `사행성`, `금지`, `제한`, `불가`, `허용` |

Use this for:

- hybrid score boost
- evidence gate pass
- rank reason

Suggested boost:

```text
topicExactBoost = 0.10 to 0.18
```

Only apply when:

- candidate content/title contains topic exact terms
- source is not fallback/mock
- lexicalOverlap >= 0.15 or keywordScore >= 0.25

### 3. Policy-title / Canonical-title Boost

Add policy-grade title detection:

```text
정책
운영정책
집행기준
심사 가이드
광고등록기준
가이드
클린센터
```

Suggested boost:

```text
policyTitleBoost = 0.06 to 0.12
```

This should help `gambling-policy`, where current rows have lexical matches but weak title quality. It also helps RAG-3K rows whose canonical title is policy-grade.

### 4. Generic-topic Rescue Slot

Add a second rescue path independent of vendor:

```ts
private isGenericTopicRescueCandidate(candidate, intent): boolean
```

Conditions:

- fixture/query is generic policy intent
- candidate is not fallback
- candidate has excerpt
- candidate has exact topic terms
- candidate has policy-grade title or canonical title
- `keywordScore >= 0.30` or `lexicalOverlap >= 0.25`
- `hybridScore >= 0.35`
- prefer `ollama_document_chunks` RAG-3F/RAG-3K rows over `document_chunks` when otherwise comparable

Final selection behavior:

- If top selected set contains only weak vector-only sources, replace the lowest-ranked selected source with the best generic-topic rescue candidate.
- If the rescue candidate is RAG-3K and exact-topic matched, insert it into top 2 for price/gambling fixtures.

Expected impact:

- `kakao-price-discount` gets at least one price/discount keyword/hybrid source.
- `gambling-policy` gets at least one policy-title/topic-exact source.

### 5. Vector-only Meta Seed Demotion

Add penalty for generic-policy queries:

Conditions:

- candidate corpus is `ollama_document_chunks`
- sourceVendor is `META`
- retrievalMethod is `vector`
- keywordScore is `0`
- lexicalOverlap <= `0.20`
- source has `missing_url`
- query has no explicit Meta intent
- there exists at least one topic-exact candidate with keyword/hybrid evidence

Suggested penalty:

```text
metaSeedGenericPenalty = 0.22 to 0.35
```

For `kakao-price-discount`, the current top Meta seed scores are only about `0.51-0.54` hybridScore. A penalty of `0.25` plus topic rescue should be enough to move them below better policy candidates.

Do not apply this penalty to:

- explicit Meta/Facebook/Instagram questions
- Meta-specific fixtures
- cases where no topic-exact candidates exist

### 6. Same-vendor Seed Repetition Penalty

In final selection, if top results are all from the original six seed rows:

- keep at most one original seed source for generic policy questions
- prefer a different corpus/vendor/title if candidate quality is acceptable

This reduces repeated Meta seed dominance without harming Meta-specific source stability.

### 7. Source Quality Adjustments

Current `missing_url` is warning/penalty but not enough to affect ranking. For generic policy questions:

- treat `missing_url` as a stronger penalty only for vector-only candidates
- do not reject `missing_url` outright because many imported chunks still lack URL
- policy-title and exact-topic matches can offset missing URL

Suggested:

```text
genericVectorMissingUrlPenalty = 0.08 to 0.12
```

## Expected Fixture Effects

| Fixture | Expected effect |
| --- | --- |
| `kakao-price-discount` | Should pass if at least one keyword/hybrid price policy source enters final sources |
| `gambling-policy` | Should pass if policy-title/topic-exact source replaces weak operational/tips source |
| vendor-specific 10 fixtures | Should remain 10/10 because vendor mismatch/rescue rules are unchanged or scoped away |
| out-of-scope weather/recipe | Should remain `noDataFound=true`; no changes to out-of-scope classifier |
| Meta specs fixtures | Should remain stable because Meta seed demotion is disabled for explicit Meta intent |

Target after RAG-3O:

```text
source-only pass: 20/20
or at minimum: 19/20 with no regression
```

## Regression Risks

| Risk | Mitigation |
| --- | --- |
| Meta fixtures lose strong seed rows | Scope demotion to generic-policy queries without explicit Meta intent |
| Weak keyword rows overtake good vector rows | Require exact topic terms and policy-grade title/rescue thresholds |
| Out-of-scope false positives return | Do not change out-of-scope detection or fallback guard |
| Too many RAG-3K rows dominate | Limit generic topic rescue to one slot initially |
| Source diversity changes unexpectedly | Preserve existing dedupe/title/vendor caps |
| Confidence shifts downward | Recalculate after fixture run; lower confidence is acceptable if sources are more relevant |

## Implementation Candidates for RAG-3O

Primary file:

- `src/lib/services/RAGSearchService.ts`

Suggested changes:

1. Add helper methods for generic policy intent, exact topic match, policy title, original Meta seed detection.
2. Extend `calculateHybridScore` input or post-score adjustment to include:
   - `topicExactBoost`
   - `policyTitleBoost`
   - `genericVectorMetaSeedPenalty`
3. Extend `isVerifiedEvidence` to reject or penalize vector-only generic Meta seed when topic-exact candidates exist.
4. Extend `mergeDedupeAndRankCandidates` with generic-topic rescue slot.
5. Extend `rankReason` with:
   - `topic_exact_match`
   - `policy_title_boost`
   - `generic_topic_rescue`
   - `generic_vector_seed_penalty`

Optional:

- `scripts/evaluate-rag-fixtures.mjs` only if diagnostics need to show new rank reasons.

## Verification Plan for RAG-3O

Run:

```bash
npm run type-check
npm run build
npm run verify:migration
npm run verify:harness
npm run smoke:chat-ollama-local
npm run evaluate:rag-fixtures -- --run
npm run evaluate:rag-fixtures -- --run --diagnostics
```

Production smoke after push:

- `/api/chat-ollama` general query
- price/discount query
- gambling query
- confirm `schema=compass`
- confirm sources retained even if Ollama generation fails

## RAG-3O Approval Prompt

```text
Gate RAG-3O generic policy ranking/evidence gate tuning 구현을 승인한다.

목표:
- RAG-3M에서 남은 kakao-price-discount, gambling-policy 실패를 줄인다.
- generic-policy query에서 exact topic match, policy-title boost, vector-only Meta seed demotion, generic topic rescue slot을 구현한다.
- DB schema/data/env/reembedding/crawler 변경은 금지한다.
- response contract breaking change는 금지한다.

수정 후보:
- src/lib/services/RAGSearchService.ts
- 필요 시 scripts/evaluate-rag-fixtures.mjs는 diagnostics 표시만 최소 변경

검증:
- npm run type-check
- npm run build
- npm run verify:migration
- npm run verify:harness
- npm run smoke:chat-ollama-local
- npm run evaluate:rag-fixtures -- --run
- npm run evaluate:rag-fixtures -- --run --diagnostics

Git:
- 변경 파일만 commit
- commit message: feat: tune Compass generic policy evidence ranking
- git push origin main
```
