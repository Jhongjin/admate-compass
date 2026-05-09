# Gate Compass-NoData-1

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: read-only failure investigation
Target fixture: `화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘`

## 1. Executive Summary

The noDataFound failure is not primarily a UI rendering problem.

The current source path treats the fixture as an in-domain generic policy query because it contains strong ad-policy terms such as `광고` and `심사`. Since the query is not classified as out of scope, `RAGSearchService` runs hybrid retrieval, applies the evidence gate, and can return up to three verified sources. `/api/chat-ollama` then marks `noDataFound=false` whenever at least one verified source survives.

In UI-QA-3C, the UI showed a generation-limited/additional-verification state with `근거 문서 3개` because retrieval succeeded enough to preserve sources, while generation was limited. That is consistent with the current API route behavior.

No production query, reembedding, crawler, DB mutation, code edit, stage, commit, or push was performed in this gate.

## 2. Prior Observed Failure

From UI-QA-3C:

- expected: vendor-neutral noDataFound state
- actual: generation-limited/additional-verification state
- visible source state: `근거 문서 3개`
- source character: generic advertising policy evidence

From UI-QA-4 triage:

- likely primary surface: `RAGSearchService` intent/evidence gating
- secondary surface: `/api/chat-ollama` response policy
- least likely surface: UI rendering

## 3. Static Intent Classification

The exact fixture was evaluated locally using the same static term lists and token extraction logic as the source code, without calling `/api/chat-ollama` or production APIs.

Result:

```json
{
  "vendors": [],
  "topics": ["review"],
  "keywords": ["화성", "거주용", "산소", "농장", "광고의", "3027년", "심사", "기준을"],
  "adPolicyTerms": ["광고", "심사"],
  "outOfScopeTerms": [],
  "isOutOfScope": false,
  "isGenericPolicyIntent": true
}
```

Interpretation:

- `화성`, `산소 농장`, and `3027년` are not represented in the current out-of-scope term list.
- `광고` and `심사` are represented as ad-policy terms.
- `심사` maps the query to the `review` topic.
- Because the out-of-scope rule is `outOfScopeTerms.length > 0 && adPolicyTerms.length === 0`, the query stays in scope.
- Because there is a topic, no vendor, and ad-policy terms, the query becomes generic policy intent.

## 4. `/api/chat-ollama` Flow

Relevant file:

- `src/app/api/chat-ollama/route.ts`

Observed flow:

1. The route calls RAG with a source limit of 3:
   - `searchWithOllamaRAG(message, 3)`
2. RAG results are filtered only for:
   - non-empty content
   - not fallback retrieval
   - not fallback source quality
3. The route returns `noDataFound=true` only when `verifiedSearchResults.length === 0`.
4. If verified sources exist, the route builds `sources`, computes confidence, then tries Ollama generation.
5. If Ollama generation fails after retrieval, the route intentionally preserves sources and returns:
   - `response.sources = sources`
   - `response.noDataFound = false`
   - `model = "ollama-connection-failed"`

Impact:

The route has no scenario-level guard for "impossible future Mars oxygen farm" once retrieval has returned verified evidence. Any surviving verified source makes the response non-noData.

## 5. `RAGSearchService` Flow

Relevant file:

- `src/lib/services/RAGSearchService.ts`

Observed flow:

1. `searchSimilarChunks` detects intent.
2. It stops early only if `intent.isOutOfScope` is true.
3. Otherwise it generates an embedding and runs both vector and keyword retrieval.
4. Vector retrieval uses `match_threshold: 0.001`, which is intentionally broad.
5. Keyword retrieval queries both `ollama_document_chunks` and `document_chunks` using extracted keywords.
6. Candidates are normalized with vector score, keyword score, lexical overlap, vendor alignment, topic match, policy-title match, source quality, and hybrid score.
7. `mergeDedupeAndRankCandidates` keeps candidates that pass `isVerifiedEvidence`, dedupes them, ranks by hybrid score, and slices to the requested limit.

Evidence gate notes:

- `isVerifiedEvidence` rejects empty/fallback/low-score candidates.
- It accepts evidence when candidate signals are strong enough, including:
  - vendor match
  - generic policy + exact topic + policy title + lexical overlap
  - keyword score and lexical overlap
  - sufficient lexical overlap
  - high vector score plus lexical overlap
- The current generic policy rescue path is meant to improve generic policy retrieval quality, not to reject impossible scenarios.

## 6. Why Generic Sources Can Attach

Most likely cause:

The fixture mixes impossible scenario terms with valid policy terms. The current classifier only recognizes a small set of non-ad out-of-scope topics, and it lets ad-policy terms override out-of-scope classification. Therefore the impossible parts do not stop retrieval.

Contributing factors:

- `광고` and `심사` are strong domain signals.
- `심사` produces a `review` topic.
- `화성`, `산소 농장`, and future-year patterns are not out-of-scope signals.
- Vector retrieval is intentionally permissive.
- Generic policy evidence can pass when topic/title/keyword/vector signals are good enough.
- `/api/chat-ollama` treats "any verified source exists" as `noDataFound=false`.
- Generation failure is explicitly separated from retrieval failure, so generation-limited responses preserve sources instead of becoming noData.

## 7. Source Count 3 Path

The `근거 문서 3개` state is explained by the route-level limit and source preservation path:

- `/api/chat-ollama` calls RAG with limit `3`.
- `RAGSearchService` returns up to that limit after evidence gating and ranking.
- `buildVerifiedSources` maps all verified search results to UI source objects.
- `RelatedResources` displays the valid source count when `noDataFound=false`.

This means the count itself is not a UI bug. It is the expected display of a non-noData API response with three verified sources.

## 8. UI vs API/RAG Classification

Primary failure surface:

- `RAGSearchService` intent/evidence gating.

Reason:

- The exact fixture is statically classified as in-scope generic policy.
- Once in scope, retrieval can find generic policy evidence.

Secondary possible surface:

- `/api/chat-ollama` response policy.

Reason:

- The route only checks whether verified source count is zero.
- If product policy wants impossible scenario detection after retrieval, the route could add an additional noData guard, but this would need careful contract protection for source preservation.

Least likely surface:

- UI rendering.

Reason:

- `chat-ollama/page.tsx` passes `data.response.noDataFound` and `data.response.sources` into message state.
- `ChatBubble` shows a noData message when `noDataFound=true`.
- `RelatedResources` shows "근거 문서 없음" when `noDataFound=true` or valid sources are empty.
- In UI-QA-3C, the UI rendered sources because the API response supplied sources and did not mark noData.

## 9. Production vs Local Source Possibility

Potential differences:

- Production corpus may include data-only RAG-3F/RAG-3K rows and older seed rows in `compass.ollama_document_chunks`.
- Local source code may match production logic, but corpus contents and deployment timing can affect which sources survive.
- The route behavior is stable regardless of exact corpus: if at least one verified source survives, `noDataFound=false`.
- Current Vercel deployment confirmation was not part of this gate, and no production API call was made.

Implication:

The likely failure mechanism does not require production/local code divergence. Corpus differences can change the actual three sources, but not the noData decision rule.

## 10. Fix Surface Options

### Option A: RAG intent noData guard

Add impossible-scenario detection to intent classification before retrieval.

Candidate signals:

- future year far beyond current policy horizon, such as `3027년`
- impossible location/product combinations, such as `화성`, `산소 농장`
- non-real-world regulatory target terms that should not map to ad policy evidence

Risk:

- Could over-reject creative but valid ad-policy questions that contain fictional product examples.
- Needs explicit product decision on whether fictional scenarios should return noData or generic caveated policy guidance.

### Option B: Evidence gate stricter for mixed impossible + generic policy terms

Require stronger scenario-specific evidence when the query contains impossible/future-world markers.

Risk:

- Touches RAG-3O source preservation and generic policy ranking.
- Could regress generic policy fixtures if too broad.

### Option C: API post-retrieval noData guard

Keep retrieval unchanged, but have `/api/chat-ollama` convert responses to noData when a scenario-level invalidity detector fires.

Risk:

- Adds a second noData decision layer.
- Must avoid hiding useful verified sources during generation-limited states for normal policy questions.

### Option D: Fixture expectation correction

Accept that generic ad-policy evidence can appear for impossible examples, but require the answer to caveat that Compass has no policy for Mars/3027 specifics.

Risk:

- Does not validate the vendor-neutral noDataFound UI state.
- Would require a separate noData fixture that lacks ad-policy override terms.

## 11. Required Read-Only Checks Before Fix

Before implementation, run a separate approved gate for:

1. Static tests for intent classification:
   - exact UI-QA-3C fixture
   - `내일 서울 날씨 알려줘`
   - `김치찌개 맛있게 끓이는 법 알려줘`
   - fictional ad scenario with valid policy target
   - impossible/future scenario with ad-policy terms
2. Fixture suite review:
   - add an explicit noData mixed-domain fixture
   - separate generic policy evidence fixtures from noData UI fixtures
3. Sanitized retrieval diagnostics, only if query execution is approved:
   - `noDataFound`
   - `sourcesCount`
   - source title/vendor class
   - retrieval method class
   - score bands
   - no raw provider response, token, cookie, session, or secret values
4. Regression matrix:
   - RAG fixture suite must remain `20/20`
   - out-of-scope weather and recipe remain `noDataFound=true`
   - normal generic policy questions keep verified sources
   - generation-limited responses preserve verified sources when retrieval is valid

## 12. Recommended Next Gates

1. `Compass-NoData-2 mixed-domain noData fixture design`
   - Define product behavior for impossible scenario + valid policy terms.
   - Add fixture/test expectations only after approval.
2. `Compass-NoData-3 read-only sanitized retrieval diagnostic`
   - One controlled local diagnostic for the exact fixture if approved.
   - Record only sanitized fields.
3. `Compass-NoData-4 implementation plan`
   - Choose between intent guard, evidence gate change, API post-retrieval guard, or fixture correction.
4. `Compass-NoData-5 minimal implementation`
   - Only after the above decisions.

## 13. Boundary Confirmation

Not modified:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- DB schema/import/reembedding/crawler
- noDataFound logic
- query/retrieval logic
- UI components

Not executed:

- production `/api/chat-ollama` query
- local RAG query
- crawler
- reembedding
- DB mutation
- stage/commit/push
