# Gate Compass-NoData-5

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: production logic patch plan only
Scope: no code implementation in this gate

## 1. Goal

NoData-4 added test-only fixture coverage for the noDataFound boundary. Two fixtures remain marked as expected failures until a logic patch:

- `future-impossible-mars-3027`
- `fictional-platform-moontok`

This plan defines the smallest production logic patch that should make those two fixtures return noDataFound while preserving the existing source evidence contract for valid policy questions.

## 2. Required Contracts to Preserve

Do not regress these behaviors:

| Fixture | Required behavior |
| --- | --- |
| `valid-meta-exaggeration-landing` | `noDataFound=false`, verified sources retained |
| `valid-generic-price-discount` | `noDataFound=false`, verified sources retained |
| `valid-fictional-product-meta` | `noDataFound=false`, real-platform sources retained |
| `valid-longform-wellness-multiplatform` | `noDataFound=false`, verified sources retained |
| valid retrieval plus generation failure | `noDataFound=false`, sources retained, generation-limited state allowed |
| weather/recipe out of scope | `noDataFound=true`, no sources |

The fix must not solve noData by broadly clearing sources. It should only block source exposure for explicit unavailable policy targets.

## 3. Surface Decision

### Primary surface: `RAGSearchService`

Recommended primary patch:

- add a narrow unavailable-target classifier to the RAG intent path
- run it before vector/keyword retrieval
- return no search results when the query is explicitly an unavailable policy target

Reason:

- NoData-1 showed the Mars fixture is classified as `isOutOfScope=false` and `isGenericPolicyIntent=true`
- `/api/chat-ollama` already returns `noDataFound=true` when `verifiedSearchResults.length === 0`
- fixing the query boundary before retrieval prevents generic source leakage at the source
- this avoids touching source scoring for valid policy queries

### Secondary surface: `/api/chat-ollama`

Recommended route involvement:

- do not use the route as the primary classifier
- keep the generation failure branch unchanged
- only add route-level handling if the implementation needs a more specific noData copy class

Reason:

- the route currently preserves sources on `ollama-connection-failed`, and that contract is important
- a route-only post-filter can hide valid sources if it is not perfectly aligned with RAG intent
- RAG should decide whether retrieval is appropriate; the route should format the noData response

### Evidence threshold

Do not start by changing general evidence thresholds.

Reason:

- threshold changes can regress RAG-3O source preservation
- generic policy queries intentionally rely on broad but verified policy evidence
- the two failing fixtures are scenario-boundary failures, not ordinary ranking failures

## 4. Proposed Patch Shape

Add a narrow concept such as:

```text
unavailablePolicyTarget
```

Candidate properties:

```text
isUnavailablePolicyTarget: boolean
unavailableReason: future_impossible | fictional_platform | unsupported_platform
```

Recommended flow:

1. Normalize query text.
2. Detect known real policy vendors using the existing vendor detector.
3. Detect ad-policy intent using existing ad-policy terms.
4. Detect unavailable target signals.
5. If unavailable target is true, return no search results before embedding/retrieval.
6. Let `/api/chat-ollama` return the existing noData response from the zero verified source path.
7. If product copy must be exact, add a small route copy mapping in a later or same approved logic gate.

## 5. Future / Impossible Query Criteria

The Mars fixture should become noData because it asks for a specific review standard for an impossible future scenario:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

Recommended criteria:

- query has ad-policy terms such as `광고`, `심사`, `기준`, `정책`
- and query contains a far-future year such as `3027년`
- or query combines extraterrestrial/domain-impossible markers with policy review terms
- and the request asks for a specific standard, review rule, or policy basis, not general creative advice

Suggested conservative year rule:

```text
farFutureYear = year >= 2100 OR year >= currentYear + 50
```

Do not classify as unavailable solely because:

- the query mentions a future campaign year near the current planning horizon, such as 2027
- the query includes a fictional product but a real platform
- the query asks for general policy precautions rather than a nonexistent official standard

Important ambiguity:

- `화성` can mean Mars or Hwaseong city in Korea
- therefore `화성` alone should not trigger noData
- it should require supporting impossible-context signals such as `3027년`, `우주`, `거주용 산소 농장`, or similar terms

## 6. Fictional Platform Criteria

The MoonTok fixture should become noData because it asks for policy standards for a platform that Compass does not support:

```text
MoonTok Ads에서 순간이동 장치 광고 심사 기준을 알려줘
```

Recommended criteria:

- query has ad-policy/review terms
- query contains a platform-like token or phrase
- no known supported policy vendor is detected
- the platform-like token is not in the supported vendor/corpus alias list
- the query asks for that platform's review standard or policy basis

Candidate platform-like signals:

- English brand-like token followed by `Ads`, `Ad`, `광고`, `심사`, or `정책`
- Korean/English platform phrase preceding `에서`
- phrase pattern equivalent to "`<platform> Ads`"

Supported vendor aliases should be centralized around the existing vendor detector:

- Meta / Facebook / Instagram
- Google / YouTube / GDN
- Naver
- Kakao
- any other Compass-supported vendor explicitly present in current corpus policy

Do not classify as fictional platform when:

- a known real vendor is present
- the query is a generic policy question with no platform-specific unavailable target
- the platform is unsupported but product wants a general "not in Compass corpus" message

For unsupported-but-real platforms, the behavior can still be `noDataFound=true` unless the corpus and vendor detector are intentionally expanded.

## 7. Fictional Product Preservation

The fix must not reject:

```text
Meta에서 가상의 순간이동 장치 광고를 운영한다면 과장 표현과 안전성 주장에 어떤 주의가 필요해?
```

Reason:

- the platform is real and supported
- the user asks how real policy principles apply to a hypothetical product
- Compass can provide general grounded guidance from Meta policy sources

Guardrail:

- fictional or hypothetical product terms alone must not trigger noData
- noData should require unavailable platform, impossible policy target, or impossible future official standard

## 8. Source Preservation Conditions

Existing source preservation remains valid when all of these are true:

- query is a real-world policy question
- query has a supported vendor or a valid generic policy intent
- verified non-fallback sources survive retrieval
- generation fails or is limited after retrieval

In that case:

- keep `sources`
- keep `noDataFound=false`
- keep `schema=compass`
- keep `sourcesCount` or equivalent source count contract
- keep source metadata needed by the UI evidence panel

Only hide sources when an explicit unavailable-target guard fires or when no verified sources exist.

## 9. False Positive Risks

High-risk false positives:

- `화성시 지역 광고 심사 기준` should not be treated as Mars
- `2027년 캠페인 준비 시 Meta 정책 주의사항` should not be treated as impossible future
- `가상의 화장품 브랜드를 Meta에 광고할 때 주의사항` should keep sources
- `신규 플랫폼 확장 계획` questions may mention unknown platforms while asking for general strategy rather than official policy
- English brand-like words can appear in advertiser/product names, not platform names

Mitigation:

- require combinations of signals, not one keyword
- keep a high far-future threshold
- require policy-standard request terms for future/impossible noData
- require platform-like syntax plus absence of supported vendor for fictional platform noData
- add explicit allow path for supported vendor plus hypothetical product

## 10. Test Update Criteria

After the logic patch:

1. Add or enable a behavior-level check that exercises the new unavailable-target classifier without DB/API calls.
2. Update NoData-4 fixture baseline statuses:
   - `future-impossible-mars-3027`: `expected-pass`
   - `fictional-platform-moontok`: `expected-pass`
3. Keep the fixture expectations unchanged:
   - both should remain `noDataFound=true`
   - both should keep `maxSources=0`
4. Preserve `sourcePreservationCases=4`.
5. Preserve `generationLimitedSourcePreservationCases=4`.
6. Keep `npm run check:nodata-boundary` passing.
7. Keep `npm run verify:harness` passing.

Recommended new deterministic checker:

```text
scripts/check-nodata-boundary-logic.mjs
```

This checker should use pure helper functions only. It must not call production, Supabase, Ollama, local DB, crawler, import, or reembedding.

## 11. Implementation Files for the Next Gate

Preferred minimal file set for the implementation gate:

| File | Purpose |
| --- | --- |
| `src/lib/services/RAGSearchService.ts` | add narrow unavailable-target guard before retrieval |
| `scripts/check-nodata-boundary-fixtures.mjs` or new checker | enforce behavior-level boundary if a pure seam is available |
| `docs/rag/rag-nodata-boundary-fixtures.json` | update current baseline statuses after behavior passes |

Possible route file only if copy requires it:

| File | Purpose |
| --- | --- |
| `src/app/api/chat-ollama/route.ts` | map unavailable-target reason to specific noData copy, while preserving generation-limited source behavior |

Avoid touching:

- DB schema
- corpus SQL
- import/reembedding/crawler
- source count or source card UI
- broad scoring thresholds

## 12. Rollback Criteria

Rollback the logic patch if any of the following happen:

- valid Meta fixture loses sources
- generic valid policy fixture becomes noData
- fictional product on Meta becomes noData
- long-form multi-platform fixture becomes noData
- generation-limited valid retrieval clears sources
- weather/recipe noData regress
- `schema=compass` disappears
- `npm run check:nodata-boundary` fails
- `npm run verify:harness` fails
- authenticated UI source panel no longer shows retained valid sources

Rollback method:

```text
git revert <logic-patch-commit>
```

Do not rollback NoData-4 fixture coverage unless the fixture contract itself is wrong. Do not run DB rollback, import rollback, crawler, or reembedding for this code-only fix.

## 13. Recommended Next Gates

### Gate Compass-NoData-6 minimal unavailable-target logic patch

Goal:

- implement the narrow `unavailablePolicyTarget` guard
- update fixture baseline statuses only after behavior passes
- preserve source retention and generation-limited contracts

Validation:

- `npm run check:nodata-boundary`
- behavior-level classifier check if added
- `npm run type-check`
- `npm run build`
- `npm run verify:harness`

### Gate Compass-NoData-7 post-deploy noData smoke

Goal:

- one controlled production smoke after deployment
- confirm Mars 3027 and MoonTok noData behavior if query execution is explicitly approved
- confirm a valid source-found query still retains sources

### Gate Compass-NoData-8 copy/UI refinement, only if needed

Goal:

- refine noData user-facing copy
- keep UI source/evidence panel behavior unchanged for valid sourced answers

## 14. Boundary Confirmation

This gate did not modify:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- DB schema/import/reembedding/crawler
- production noDataFound logic
- source scoring
- UI components

This gate did not execute:

- production API calls
- local RAG queries
- crawler
- reembedding
- DB mutation
- stage/commit/push
