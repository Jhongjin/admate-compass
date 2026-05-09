# Gate Compass-NoData-3

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: test-only implementation plan
Scope: no production logic change before noDataFound boundary tests

## 1. Goal

NoData-2 defined the desired policy boundary for valid policy, generic policy, impossible/future policy, fictional product, fictional platform, and long-form ambiguous policy questions.

This gate defines the test-only patch that should come before any production logic change. The test layer should lock the intended contract around:

- RAG intent classification
- evidence relevance boundaries
- `/api/chat-ollama` noData transition policy
- source preservation during generation-limited responses
- user-facing noDataFound copy

The next implementation gate should add tests and fixtures only. It should not change RAG behavior, route behavior, DB state, crawler output, import scripts, or embeddings.

## 2. Test Strategy

Recommended sequence:

1. Add a fixture contract file for noData boundary cases.
2. Add deterministic checks that validate fixture shape and expected fields without calling production APIs.
3. Add pure unit tests around classification and response-policy helpers where existing code can be exercised safely.
4. If private logic is not directly testable, add a behavior-preserving extraction/export only after explicit approval.
5. Keep any expected-to-fail behavior checks out of the default harness until the logic patch is approved, unless the gate explicitly accepts a red-test state.

This preserves a clean test contract without silently changing production behavior.

## 3. Test Target Candidates

### RAGSearchService intent classification

Purpose:

- distinguish impossible/future policy targets from normal generic policy questions
- preserve valid hypothetical product questions on real platforms
- keep weather and recipe queries out of scope

Candidate assertions:

| Fixture | Expected classifier contract |
| --- | --- |
| Meta exaggeration and landing page query | in scope, real platform, policy topic |
| generic price/discount policy query | in scope, generic policy intent |
| Mars oxygen farm 3027 query | impossible/future policy target |
| teleportation device on Meta | in scope, real platform, hypothetical product |
| MoonTok Ads teleportation policy query | unavailable or fictional platform |
| weather query | out of scope |
| recipe query | out of scope |

Implementation note:

- current classifier logic appears embedded inside `RAGSearchService`
- test-only patch should prefer a pure helper seam if one already exists
- if no seam exists, plan a follow-up behavior-preserving extraction such as `src/lib/rag/queryIntent.ts` only with approval
- do not alter threshold, scoring, retrieval, embedding, or source filtering in the test-only gate

### Evidence relevance threshold

Purpose:

- prove generic policy sources must not satisfy an impossible/future-specific target
- preserve generic valid policy sources for normal user questions

Candidate assertions with synthetic source objects:

| Condition | Expected evidence contract |
| --- | --- |
| valid policy query + source with platform/topic/title alignment | retained |
| generic valid policy query + policy source | retained |
| impossible/future target + generic review source only | not enough to answer target |
| fictional product on real platform + general safety/exaggeration source | retained |
| fictional platform + unrelated platform policy source | not retained as answer evidence |

Implementation note:

- use sanitized synthetic source fixtures only
- do not call Supabase, Ollama, production endpoints, local DB, crawler, or embeddings
- keep assertions about source metadata shape, not raw corpus contents

### `/api/chat-ollama` noData transition policy

Purpose:

- define when route-level output should become `noDataFound=true`
- preserve existing source behavior for valid retrieval plus generation failure

Mock conditions:

| Mock RAG/generation condition | Expected route contract |
| --- | --- |
| zero verified sources | `noDataFound=true`, `sources=[]` |
| valid verified sources + generation success | `noDataFound=false`, sources retained |
| valid verified sources + generation failure | `noDataFound=false`, sources retained, generation-limited model/status |
| impossible/future target guard + generic sources | `noDataFound=true`, generic sources not exposed |
| fictional product on real platform + verified sources | `noDataFound=false`, sources retained |
| fictional platform + generic sources | `noDataFound=true`, generic sources not exposed |

Implementation note:

- prefer testing a pure response-policy function if extracted later
- avoid executing the real Next route against production or local env
- no session, cookie, token, provider response, or credential values should be read or logged

## 4. Fixture Contract

Candidate fixture file:

```text
docs/rag/rag-nodata-boundary-fixtures.json
```

Recommended fields:

```json
{
  "id": "future-impossible-mars-3027",
  "question": "화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘",
  "category": "boundary-nodata",
  "expected": {
    "noDataFound": true,
    "minSources": 0,
    "maxSources": 0,
    "generationLimited": false,
    "sourcePolicy": "hide_generic_sources",
    "copyClass": "unavailable_policy_target"
  }
}
```

The fixture file should be data-only. It should not contain secrets, campaign data, customer data, raw provider output, DB URLs, cookies, tokens, or session values.

## 5. Fixture-Level Expected Assertions

| ID | Question summary | `noDataFound` | Source assertion | Generation assertion | Copy direction |
| --- | --- | --- | --- | --- | --- |
| `valid-meta-exaggeration-landing` | Meta exaggeration and landing page | `false` | at least 1 verified source | generation-limited allowed only on generation failure | grounded answer or source-preserved limited state |
| `valid-generic-price-discount` | generic price/discount policy | `false` | at least 1 verified source | generation-limited allowed only on generation failure | platform variation caveat with grounded general guidance |
| `future-impossible-mars-3027` | Mars oxygen farm 3027 review standard | `true` | no generic source cards exposed | should not enter normal sourced generation path | no evidence for requested era/place/category in Compass docs |
| `valid-fictional-product-meta` | teleportation device on Meta | `false` | retain real platform policy sources | generation-limited allowed only on generation failure | no product-specific policy, then grounded general policy guidance |
| `fictional-platform-moontok` | MoonTok Ads review standard | `true` | no unrelated platform sources exposed | should not enter normal sourced generation path | no evidence for that platform; ask for real platform |
| `valid-longform-wellness-multiplatform` | wellness app across Meta/Google/Naver/Kakao | `false` | retain verified sources | generation-limited allowed only on generation failure | multi-platform caveat, no unsupported certainty |
| `out-of-scope-weather` | weather query | `true` | no sources | no normal sourced generation | vendor-neutral noData copy |
| `out-of-scope-recipe` | recipe query | `true` | no sources | no normal sourced generation | vendor-neutral noData copy |

## 6. Source Preservation Assertions

The tests must protect the existing Compass source contract:

1. Valid policy retrieval with verified sources must keep `sources`.
2. Valid retrieval plus Ollama/generation failure must keep `sources`.
3. Valid retrieval plus generation failure must not become `noDataFound=true`.
4. `schema=compass` must remain present in API contract tests.
5. `sourcesCount` must match retained source count when available.
6. Source objects must keep user-facing title/vendor/url/snippet or equivalent evidence metadata.
7. Fallback or placeholder evidence must not count as verified source evidence.
8. Impossible/future noData cases must not expose generic source cards as if they answered the unavailable target.

These assertions are the guardrail against fixing noDataFound by simply clearing sources too broadly.

## 7. Generation-Limited Source Preservation Assertions

Add a mocked generation-failure case:

- input is a valid Meta or generic policy query
- mocked RAG returns at least one verified source
- mocked generation throws or returns a connection-limited state

Expected:

- `noDataFound=false`
- `sources` retained
- `sourcesCount` retained when the response shape includes it
- model/status may indicate generation-limited or Ollama connection failure
- user-facing copy can explain answer limitation, but evidence remains visible

Do not test this by forcing a real Ollama failure. Use a stub.

## 8. noDataFound Copy Assertions

The noData copy should be checked at contract level without requiring screenshot QA.

Required copy properties:

- explains that Compass did not find policy evidence for the requested target
- stays vendor-neutral when no real platform is identified
- asks the user to provide a real platform or narrower policy target when useful
- avoids internal terms such as `retrievalMethod`, `sourceQuality`, `ollama_document_chunks`, `embedding`, `hybrid score`, or `RAGSearchService`
- does not imply that generic sources answer an unavailable future/fictional policy target

Candidate Korean copy class:

```text
Compass 문서 기준으로 해당 정책 근거를 찾지 못했습니다.
실제 플랫폼명이나 확인하려는 정책 범위를 다시 입력해 주세요.
```

The test should assert copy class or required fragments, not a brittle full sentence, unless the product team explicitly freezes exact copy.

## 9. Test File Candidates

Recommended data and script candidates:

| File | Purpose |
| --- | --- |
| `docs/rag/rag-nodata-boundary-fixtures.json` | data-only fixture contract |
| `scripts/check-nodata-boundary-fixtures.mjs` | validates fixture schema and expected assertion fields |
| `scripts/check-nodata-response-contract.mjs` | mock-based route response policy check if a pure helper seam exists |
| `scripts/check-nodata-intent-contract.mjs` | classifier contract check if a pure helper seam exists |
| `docs/tasks/2026-05-09_compass_nodata_4_test_only_patch_result_v1.md` | next gate result report |

If the repo already has a preferred fixture runner, the new fixtures should plug into that runner instead of creating parallel infrastructure.

Potential package script:

```json
{
  "check:nodata-boundary": "node scripts/check-nodata-boundary-fixtures.mjs"
}
```

Do not add this script to the default harness until the expected pass/fail policy is approved.

## 10. Mock and Stub Criteria

Allowed:

- synthetic query strings from NoData-2
- synthetic RAG result objects with sanitized titles, vendors, snippets, URLs, and scores
- mocked generation success
- mocked generation failure
- deterministic current-year handling for future-year checks
- local pure functions with no network or DB access

Not allowed:

- production `/api/chat-ollama` calls
- local DB calls
- Supabase calls
- crawler execution
- reembedding
- import scripts
- real Ollama calls
- reading `.env*`
- token/cookie/session inspection
- raw provider response capture

## 11. Production Env and API Call Ban

The test-only patch should be safe to run in CI and local development without production access.

Rules:

- tests must not require production environment variables
- tests must not fetch `https://compass.admate.ai.kr`
- tests must not call `/api/chat-ollama`
- tests must not instantiate service-role Supabase clients
- tests must not mutate filesystem outside the target fixture/test files
- tests must not print secrets, cookies, sessions, provider payloads, or DB connection strings

If a script detects that it would need live credentials or a live endpoint, it should fail closed with a clear message instead of falling back to production.

## 12. Red-Test Policy

There are two acceptable routes for the next gate:

### Option A: Passing contract scaffold

Add the fixture contract and schema/static checks only. This gives the product and engineering team a reviewable contract before behavior enforcement.

Pros:

- no temporary failing default checks
- low risk for commit/push
- clear artifact for implementation review

Cons:

- does not prove current code violates the desired behavior

### Option B: Explicit expected-failure behavior tests

Add mock-based behavior tests that demonstrate the current noData boundary gap, but keep them in a non-default script until the logic patch is approved.

Pros:

- documents the exact behavioral gap
- makes the following logic patch easier to verify

Cons:

- must be clearly labeled to avoid confusing CI and `verify:harness`

Recommended choice:

- start with Option A for `Compass-NoData-4`
- add Option B only if the next gate explicitly approves expected-failure tests
- enable behavior enforcement in the default harness after the logic patch passes

## 13. Verification Plan for NoData-4

For the test-only patch:

```text
git diff --check -- <new fixture/test files>
npm run type-check
npm run build
npm run verify:harness
npm run check:nodata-boundary --if-present
```

Additional manual checks:

- staged files are only approved fixture/test files
- no `RAGSearchService` behavior change
- no `/api/chat-ollama` behavior change
- no DB/crawler/reembedding file changes
- `next-env.d.ts` not staged

## 14. Next Gate Sequence

### Gate Compass-NoData-4 test-only patch

Goal:

- add noData boundary fixture contract
- add deterministic fixture schema checker
- optionally add non-default mock behavior checks if explicitly approved
- no production logic change

### Gate Compass-NoData-5 minimal logic patch

Goal:

- implement the smallest approved classifier/route/evidence boundary change
- preserve valid source and generation-limited contracts
- turn relevant boundary checks on after behavior passes

### Gate Compass-NoData-6 post-deploy noData smoke

Goal:

- one controlled authenticated or approved production smoke after deployment
- verify noDataFound state and source preservation without repeated queries

## 15. Boundary Confirmation

Not modified by this plan:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- DB schema/import/reembedding/crawler
- noDataFound logic
- source scoring or retrieval logic
- UI components

Not planned for NoData-4:

- production API calls
- local RAG query execution
- crawler execution
- reembedding
- DB mutation
- credential/session/token inspection
