# Gate Compass-NoData-2

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: read-only policy and fixture test plan
Scope: noDataFound policy design before implementation

## 1. Current Problem

UI-QA-3C found that the noDataFound fixture:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

did not enter the expected noDataFound state. Instead, the UI showed a generation-limited/additional-verification state with `근거 문서 3개`.

NoData-1 confirmed the current source path:

- the fixture is classified as `isOutOfScope=false`
- the fixture is classified as `isGenericPolicyIntent=true`
- RAG retrieval runs
- generic advertising policy sources can survive evidence gating
- `/api/chat-ollama` returns `noDataFound=false` whenever at least one verified source survives
- generation failure preserves verified sources and returns a generation-limited state instead of noData

This means the failure is not primarily UI rendering. It is a policy boundary problem between out-of-scope detection, generic policy evidence preservation, and route-level noData transition.

## 2. Policy Goal

Compass should distinguish five user-intent buckets:

1. Clearly valid policy questions
2. Generic but valid advertising policy questions
3. Future/impossible policy questions that request specific unavailable standards
4. Fictional product/platform questions
5. Long-form ambiguous Korean policy questions

The guiding rule:

```text
Preserve sources whenever Compass found real, relevant policy evidence for a real-world ad-policy question.
Return noDataFound when the requested policy target itself is unavailable, impossible, fictional as a platform, or outside the policy corpus.
```

This should not convert normal Ollama generation failures into noData. If retrieval is valid and sources are verified, generation-limited responses must keep sources.

## 3. Surfaces That May Need Change

### `RAGSearchService` intent classifier

Possible responsibility:

- detect impossible/future policy targets before retrieval
- distinguish "fictional product on real platform" from "fictional platform or impossible jurisdiction"
- add explicit mixed-domain fixture coverage

Likely code area:

- `detectQueryIntent`
- out-of-scope term/signals
- any new helper such as `detectImpossiblePolicyTarget`

Risk:

- too broad a classifier could suppress legitimate creative examples, such as "Meta에서 가상의 화장품 브랜드 광고를 운영할 때 주의사항"

### Evidence relevance threshold

Possible responsibility:

- prevent generic policy sources from satisfying questions that request impossible/future-specific standards
- require stronger scenario-level alignment when impossible markers are present

Likely code area:

- `isVerifiedEvidence`
- `calculateHybridScore`
- generic policy rescue helpers

Risk:

- could regress RAG-3O source preservation, generic policy ranking, and source count behavior

### `/api/chat-ollama` noData transition policy

Possible responsibility:

- apply a route-level noData transition after retrieval if a deterministic scenario guard fires
- preserve existing behavior for valid retrieval plus generation failure

Likely code area:

- verified source filtering and noData branch around `verifiedSearchResults.length === 0`

Risk:

- a route-level guard can hide real sources if it is not aligned with the RAG classifier
- could alter production API contract around `schema=compass`, `sources`, and `sourcesCount`

## 4. Proposed Fixture Set

The fixture set should be added as a small focused suite before implementation. It should run without DB mutation, crawler, import, or reembedding.

### Fixture 1: Clearly valid policy query

Question:

```text
Meta 광고 소재에서 과장 표현과 랜딩 페이지 관련 주의사항을 알려줘
```

Expected:

| Field | Expected |
| --- | --- |
| `noDataFound` | `false` |
| sources retained | yes, at least 1 verified source |
| generation-limited | allowed only if Ollama generation fails |
| user-facing copy | answer should cite real source evidence; if generation-limited, tell the user the answer is limited but sources are preserved |

Purpose:

- protects the successful source-found behavior from UI-QA-3C
- confirms noData changes do not suppress normal Meta policy retrieval

### Fixture 2: Generic but valid policy query

Question:

```text
광고 소재에 가격이나 할인율을 표시할 때 플랫폼 공통으로 주의할 점은?
```

Expected:

| Field | Expected |
| --- | --- |
| `noDataFound` | `false` |
| sources retained | yes, at least 1 verified policy source |
| generation-limited | allowed only if Ollama generation fails |
| user-facing copy | explain that policies vary by platform and use the retained evidence as general guidance |

Purpose:

- preserves generic policy behavior
- prevents a future impossible-scenario guard from rejecting real generic advertising-policy questions

### Fixture 3: Future/impossible policy query

Question:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

Expected:

| Field | Expected |
| --- | --- |
| `noDataFound` | `true` |
| sources retained | no, sources should be empty or hidden from final response |
| generation-limited | no, generation should not run as a normal sourced answer path |
| user-facing copy | vendor-neutral noData copy: Compass 문서 기준으로 해당 시대/장소/업종의 심사 기준 근거를 찾지 못했다고 안내 |

Purpose:

- reproduces UI-QA-3C failure as a deterministic regression fixture
- ensures impossible/future-specific requests do not attach generic ad-policy sources

### Fixture 4A: Fictional product on a real platform

Question:

```text
Meta에서 가상의 순간이동 장치 광고를 운영한다면 과장 표현과 안전성 주장에 어떤 주의가 필요해?
```

Expected:

| Field | Expected |
| --- | --- |
| `noDataFound` | `false` |
| sources retained | yes, retain general Meta/policy evidence |
| generation-limited | allowed only if Ollama generation fails |
| user-facing copy | clearly state that Compass has no product-specific policy for the fictional item, then provide general policy guidance grounded in sources |

Purpose:

- prevents the impossible-scenario guard from rejecting useful "apply real policy to a fictional creative example" questions
- protects planner-style hypothetical use cases

### Fixture 4B: Fictional platform or unavailable policy corpus

Question:

```text
MoonTok Ads에서 순간이동 장치 광고 심사 기준을 알려줘
```

Expected:

| Field | Expected |
| --- | --- |
| `noDataFound` | `true` |
| sources retained | no, unless a future corpus explicitly contains MoonTok Ads |
| generation-limited | no |
| user-facing copy | Compass 문서에서 해당 플랫폼 정책 근거를 찾지 못했다고 안내하고, 실제 플랫폼명을 입력해 달라고 안내 |

Purpose:

- separates fictional product examples from fictional platform policy requests
- guards against generic source leakage for non-existent platforms

### Fixture 5: Korean long-form ambiguous query

Question:

```text
새로운 웰니스 앱 광고를 Meta, Google, Naver, Kakao에 집행하려고 하는데, 효능 표현과 후기 사용, 랜딩 페이지 고지에서 공통으로 조심해야 할 점을 길게 정리해줘
```

Expected:

| Field | Expected |
| --- | --- |
| `noDataFound` | `false` |
| sources retained | yes, source panel should retain verified sources |
| generation-limited | allowed only if Ollama generation fails |
| user-facing copy | multi-platform caveat, platform-specific differences where evidence supports them, no unsupported certainty |

Purpose:

- protects long-form valid policy usage
- ensures mixed multi-platform questions still retrieve sources
- prevents over-aggressive noData classification from rejecting broad but valid planning questions

## 5. Normal Source Preservation Contract

Do not break these contracts:

1. If retrieval finds verified, non-fallback evidence for a valid policy question, `sources` must be preserved.
2. Ollama generation failure must not clear sources for valid retrieval.
3. `noDataFound=true` should mean Compass did not find usable evidence for the requested policy target.
4. `noDataFound=true` responses should not show generic policy source cards as if they answer the unavailable target.
5. `schema=compass` must remain present.
6. Existing source metadata should remain available for UI evidence surfaces.
7. Weather and recipe out-of-scope fixtures must remain `noDataFound=true`.
8. RAG-3O style source evaluation must not regress from the current passing baseline.

## 6. Unit / Contract Test Candidates

### Intent classifier tests

Add deterministic tests around classifier-only behavior:

| Case | Expected classifier outcome |
| --- | --- |
| valid Meta exaggeration/landing query | in scope, vendor `META`, policy topic |
| generic price/discount policy query | in scope, generic policy |
| Mars oxygen farm 3027 query | impossible/future policy target |
| fictional product on Meta | in scope, real platform, hypothetical product |
| fictional MoonTok Ads platform | unavailable/fictive platform |
| weather query | out of scope |
| recipe query | out of scope |

### Route contract tests

Mock RAG result categories instead of calling production:

| Mock condition | Expected route response |
| --- | --- |
| zero verified sources | `noDataFound=true`, `sources=[]` |
| valid verified sources + generation success | `noDataFound=false`, sources retained |
| valid verified sources + generation failure | `noDataFound=false`, sources retained, generation-limited model |
| impossible target guard + generic sources | `noDataFound=true`, generic sources not exposed |
| fictional product on real platform + sources | `noDataFound=false`, sources retained |

### Fixture contract tests

Add a focused fixture file or tagged subset:

- `docs/rag/rag-nodata-boundary-fixtures.json`
- or add `category: "boundary-nodata"` to the existing fixture suite if the evaluator supports filtering later

Required assertions:

- `expectNoDataFound`
- `minSources`
- `requireSourceQuality`
- `requireRetrievalMethods`
- `sourceMustNotContain`
- sanitized diagnostic fields only

## 7. Production Risk

High-risk areas:

- generic policy ranking can regress if evidence thresholds become too strict
- source preservation during `ollama-connection-failed` can regress if route noData handling is too broad
- fictional product questions may become falsely rejected
- production can appear less helpful if every unusual scenario becomes noData
- changing `/api/chat-ollama` response shape can affect UI and harness expectations

Risk controls:

- implement classifier tests before code changes
- keep impossible/future target detection narrow and explainable
- prefer additive metadata/classification flags over broad source filtering
- verify both noData and source-preservation paths
- run the full fixture harness after every change
- do not change DB, crawler, import, or reembedding for this fix

## 8. Rollback Criteria

Rollback or hold release if any of the following happens:

- valid source-found fixture loses sources
- generic valid policy fixture returns `noDataFound=true`
- long-form ambiguous valid fixture returns `noDataFound=true`
- weather/recipe out-of-scope regress to `noDataFound=false`
- generation-limited valid retrieval clears sources
- `schema=compass` or source metadata disappears
- fixture harness fails or RAG source evaluation regresses
- production UI shows noData copy for normal policy questions

Rollback method should be a normal git revert of the implementation commit only. Do not rollback corpus imports, DB schema, crawler output, or reembedding unless a separate approved DB gate says so.

## 9. Recommended Implementation Direction

Preferred sequence:

1. Add tests for boundary classification and route response policy.
2. Add a narrow classifier concept for impossible/future policy targets.
3. Keep valid retrieval plus generation failure source preservation unchanged.
4. Only add route-level noData transition if it consumes an explicit classifier flag, not generic weak evidence alone.
5. Re-run full harness and one controlled authenticated UI smoke after implementation.

Avoid:

- broad keyword blacklists that reject all fictional examples
- using vector score alone to decide noData
- clearing sources on Ollama failure
- changing source count or evidence metadata for valid policy queries

## 10. Next Gate Proposal

### Gate Compass-NoData-3 boundary fixture/test scaffold plan

Goal:

- choose exact fixture storage location
- define unit/contract test shape
- identify minimal files to modify
- still no RAG/API implementation

### Gate Compass-NoData-4 boundary tests implementation

Goal:

- add classifier/route tests or deterministic fixture checks
- no production query execution
- no DB mutation

### Gate Compass-NoData-5 minimal noData boundary implementation

Goal:

- implement the smallest approved noData boundary change
- preserve source evidence contract
- verify against full harness and authenticated UI noData smoke

## 11. Boundary Confirmation

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
