# Gate Compass-NoData-8

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: closure report
Scope: Compass noDataFound boundary fix sequence

## 1. Closure Summary

Compass noDataFound boundary work is complete for the two failure cases discovered after authenticated UI QA.

Closed issues:

- future/impossible policy target no longer attaches generic policy sources
- fictional platform policy target no longer attaches generic policy sources
- valid Meta policy query still preserves sources
- generation-limited valid retrieval still preserves sources
- `/api/chat-ollama` production route was not modified
- DB/schema/import/reembedding/crawler were not modified

Production smoke passed on 2026-05-09.

## 2. Original Failure

UI-QA-3C found a noDataFound failure for this out-of-scope fixture:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

Expected:

```text
noDataFound=true 또는 사용자-facing noData 상태
```

Observed before fix:

- response displayed generation-limited/additional-verification state
- UI showed `근거 문서 3개`
- generic advertising policy sources were attached to an impossible future policy target

This was not primarily a UI rendering bug. It was a RAG intent boundary issue.

## 3. NoData-1 Investigation

NoData-1 performed a read-only investigation and found:

- the Mars 3027 fixture was classified as `isOutOfScope=false`
- it was classified as `isGenericPolicyIntent=true`
- `광고` and `심사` overrode the unavailable/impossible nature of the query
- RAG retrieval could return generic advertising policy evidence
- `/api/chat-ollama` returned `noDataFound=false` whenever at least one verified source survived
- Ollama generation failure intentionally preserved verified sources

Primary failure surface:

```text
RAGSearchService intent/evidence boundary
```

Secondary surface:

```text
/api/chat-ollama response policy, only if special noData copy became necessary
```

## 4. NoData-2 Policy Fixtures

NoData-2 defined the policy boundary before implementation.

The fixture set separated:

1. clearly valid policy query
2. generic but valid policy query
3. future/impossible policy query
4. fictional product on a real platform
5. fictional platform query
6. Korean long-form ambiguous policy query
7. weather out-of-scope
8. recipe out-of-scope

The guiding rule:

```text
Preserve sources whenever Compass found real, relevant policy evidence for a real-world ad-policy question.
Return noDataFound when the requested policy target itself is unavailable, impossible, fictional as a platform, or outside the policy corpus.
```

The plan explicitly protected source preservation during generation-limited responses.

## 5. NoData-3 Test Plan

NoData-3 planned the test-only implementation layer before any production logic change.

Key decisions:

- use fixture-driven contract checks
- avoid production API calls in deterministic tests
- add source preservation assertions
- add generation-limited source preservation assertions
- check noDataFound copy expectations without exposing internal terms
- keep expected-fail behavior visible until the logic patch

This established the sequence:

```text
fixture contract first -> minimal RAG intent patch -> production smoke
```

## 6. NoData-4 Test-Only Coverage

NoData-4 added test-only fixture coverage:

- `docs/rag/rag-nodata-boundary-fixtures.json`
- `scripts/check-nodata-boundary-fixtures.mjs`
- `npm run check:nodata-boundary`
- `verify:harness` integration

Initial baseline:

```text
expected-pass: 6
expected-fail-until-logic-patch: 2
```

The expected-fail fixtures were:

- `future-impossible-mars-3027`
- `fictional-platform-moontok`

NoData-4 did not modify production RAG/API logic.

## 7. NoData-5 Logic Patch Plan

NoData-5 chose the minimum safe implementation surface.

Decision:

- primary fix in `RAGSearchService` intent boundary
- do not start with `/api/chat-ollama`
- do not change broad evidence thresholds
- do not clear sources broadly

Rationale:

- the failure occurred because unavailable targets entered retrieval as generic policy intent
- `/api/chat-ollama` already returns noData when verified source count is zero
- keeping the route unchanged protects generation-limited source preservation

Required preserved behavior:

- valid Meta query keeps sources
- generic valid policy keeps sources
- fictional product on a real platform keeps sources
- Korean long-form ambiguous query keeps sources
- generation-limited valid retrieval keeps sources

## 8. NoData-6 RAG Intent Boundary Patch

NoData-6 implemented the minimal RAG intent boundary patch.

Files changed:

- `src/lib/services/RAGSearchService.ts`
- `src/lib/services/ragNoDataIntentBoundary.mjs`
- `scripts/check-nodata-boundary-fixtures.mjs`
- `docs/rag/rag-nodata-boundary-fixtures.json`

Implementation summary:

- added a pure `detectUnavailablePolicyTarget` helper
- classified far-future/impossible policy-standard requests as unavailable
- classified unsupported platform-like Ads targets as unavailable
- stopped RAG retrieval before embedding/retrieval when unavailable target is detected
- kept `/api/chat-ollama` route unchanged
- kept generation-limited source preservation route behavior unchanged

NoData-4 baseline after patch:

```text
expected-pass: 8
```

Validation passed:

- `npm run check:nodata-boundary`
- `npm run type-check`
- `npm run build`
- `npm run verify:harness`

## 9. NoData-7 Production Smoke

NoData-7 performed read-only production smoke against:

```text
https://compass.admate.ai.kr/api/chat-ollama
```

Each fixture was queried exactly once.

### future/impossible

Question:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

Production result:

| Field | Result |
| --- | --- |
| `schema` | `compass` |
| `noDataFound` | `true` |
| `model` | `vultr-ollama-no-data` |
| `sourcesCount` | `0` |
| verdict | PASS |

### fictional platform

Question:

```text
MoonTok Ads에서 건강기능식품 광고 심사 기준을 알려줘
```

Production result:

| Field | Result |
| --- | --- |
| `schema` | `compass` |
| `noDataFound` | `true` |
| `model` | `vultr-ollama-no-data` |
| `sourcesCount` | `0` |
| verdict | PASS |

### valid Meta source preservation

Question:

```text
Meta 광고 소재에서 과장 표현과 랜딩 페이지 관련 주의사항을 알려줘
```

Production result:

| Field | Result |
| --- | --- |
| `schema` | `compass` |
| `noDataFound` | `false` |
| `model` | `ollama-connection-failed` |
| `sourcesCount` | `3` |
| verdict | PASS |

The valid Meta result confirmed that sources remain visible even when Ollama generation is connection-limited.

## 10. Completed Commit Chain

Relevant commits:

| Commit | Summary |
| --- | --- |
| `27d96d6` | `docs: investigate Compass noDataFound gating` |
| `8c262a6` | `docs: plan Compass noDataFound policy fixtures` |
| `24c4d92` | `docs: plan Compass noDataFound test coverage` |
| `a11cb1f` | `test: add Compass noData boundary fixtures` |
| `a62261d` | `docs: plan Compass noDataFound logic patch` |
| `e328846` | `fix: tighten Compass noData intent boundary` |
| `7106531` | `docs: verify Compass noDataFound production smoke` |

## 11. Explicit Non-Changes

Not changed:

- `src/app/api/chat-ollama/route.ts`
- DB schema
- DB import scripts
- reembedding
- crawler
- source/evidence UI
- authenticated login flow

Not executed:

- DB migration
- import
- reembedding
- crawler
- repeated production queries
- raw provider response capture
- secret/token/cookie/session inspection

## 12. Remaining Risk and Backlog

Remaining risk:

- broader unknown-platform edge cases beyond `MoonTok Ads`
- ambiguous real-world place names such as `화성시` versus Mars-like context
- future year edge cases around real planning horizons
- uncommon product names that look like platforms
- localized platform aliases not yet in the supported vendor alias list

Separate backlog:

- ordinary user permission UX QA
- authenticated `/chat-ollama` visual QA beyond the covered mobile layout pass
- broader noData copy refinement if product wants more specific unavailable-target messaging
- admin/debug warning 25개 review backlog
- Ollama connection/model health work, while preserving verified source behavior

## 13. Closure Verdict

Compass noDataFound boundary issue is closed for the reported failure class.

Closure state:

```text
PASS
```

The production system now returns noData for:

- future/impossible policy target
- fictional platform policy target

The production system still preserves sources for:

- valid Meta policy query
- generation-limited valid retrieval

This completes the NoData-1 through NoData-7 sequence.
