# Gate Compass-NoData-7

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: production read-only smoke
Production target: `https://compass.admate.ai.kr/api/chat-ollama`

## 1. Goal

Verify that the NoData-6 intent boundary patch behaves as intended in production after deployment.

Focus:

- future/impossible policy target returns noData
- fictional platform policy target returns noData
- valid Meta policy query preserves sources
- valid source preservation remains intact even when generation is limited

## 2. Commit Context

Local HEAD:

```text
e328846 fix: tighten Compass noData intent boundary
```

Origin `main`:

```text
e3288468fac9ca0e622de775f483ae4e9bfda35b
```

Production deployment commit was not separately inspected through Vercel metadata in this gate. Production behavior matched the NoData-6 boundary expectations.

## 3. Execution Boundary

Executed:

- production `/api/chat-ollama` POST smoke
- each fixture exactly once
- sanitized contract-field review only

Not executed:

- repeated fixture queries
- production mutation
- DB/schema/import/reembedding/crawler
- reembedding/crawler
- code edit outside this report
- stage/commit/push

Not modified:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- DB/schema/import/reembedding/crawler

## 4. Fixture Results

### Fixture 1: future/impossible

Question:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

Expected:

```text
noDataFound=true 또는 사용자-facing noData 상태
```

Observed sanitized contract:

| Field | Result |
| --- | --- |
| request count | 1 |
| HTTP | POST completed |
| `schema` | `compass` |
| `noDataFound` | `true` |
| `model` | `vultr-ollama-no-data` |
| `sourcesCount` | `0` |
| user-facing state | noData copy shown |
| elapsed | 1705 ms |

Verdict:

```text
PASS
```

### Fixture 2: fictional platform

Question:

```text
MoonTok Ads에서 건강기능식품 광고 심사 기준을 알려줘
```

Expected:

```text
noDataFound=true 또는 사용자-facing noData 상태
```

Observed sanitized contract:

| Field | Result |
| --- | --- |
| request count | 1 |
| HTTP | POST completed |
| `schema` | `compass` |
| `noDataFound` | `true` |
| `model` | `vultr-ollama-no-data` |
| `sourcesCount` | `0` |
| user-facing state | noData copy shown |
| elapsed | 532 ms |

Verdict:

```text
PASS
```

### Fixture 3: valid source preservation

Question:

```text
Meta 광고 소재에서 과장 표현과 랜딩 페이지 관련 주의사항을 알려줘
```

Expected:

```text
noDataFound=false, sources 보존
```

Observed sanitized contract:

| Field | Result |
| --- | --- |
| request count | 1 |
| HTTP | POST completed |
| `schema` | `compass` |
| `noDataFound` | `false` |
| `model` | `ollama-connection-failed` |
| `sourcesCount` | `3` |
| user-facing state | generation-limited copy shown, sources preserved |
| elapsed | 39007 ms |

Verdict:

```text
PASS
```

## 5. Summary

Production smoke passed.

NoData-6 intent boundary behavior is visible in production:

- `future-impossible` returned noData with zero sources
- `fictional-platform` returned noData with zero sources
- valid Meta policy query kept `noDataFound=false`
- valid Meta policy query preserved three sources even though generation was limited by Ollama connection state

This confirms the main risk guardrail: noData tightening did not clear valid retrieved sources.

## 6. Residual Notes

- Ollama generation is still connection-limited for the valid Meta query, but source preservation is intact.
- Existing admin/debug surface warnings remain separate backlog.
- This gate did not perform authenticated UI visual QA.
- This gate did not inspect raw provider responses, credentials, tokens, cookies, sessions, or `.env*` values.

## 7. Next Gate Proposal

Recommended next gate:

```text
Gate Compass-NoData-8 closure report
```

Purpose:

- close the NoData-1 through NoData-7 sequence
- record the production pass state
- list remaining RAG/UI/authenticated QA backlog separately
