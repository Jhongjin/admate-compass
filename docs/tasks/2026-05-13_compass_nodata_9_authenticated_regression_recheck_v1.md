# Compass NoData-9 Authenticated Regression Recheck

Date: 2026-05-13

## Scope

This gate rechecked the Compass authenticated noData fixture after the source-panel QA result suggested that the noData fixture still returned generic sources.

The recheck used the already authenticated production Compass browser session at `https://compass.admate.ai.kr/chat-ollama`.

No cookie, token, session, raw provider response, raw source payload, or secret value was read or printed.

## Fixture

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

## Local Contract Check

The local noData intent helper classifies the fixture as unavailable before RAG search.

Sanitized result:

```text
isUnavailablePolicyTarget: true
reason: future_impossible
farFutureYears: 3027
```

This matches the expected contract from `docs/rag/rag-nodata-boundary-fixtures.json`.

## Production API Shape Recheck

Method:

- One authenticated production request to `/api/chat-ollama`.
- Same-origin browser context only.
- No cookie/session extraction.
- No raw source content printed.
- No DB, RAG index, crawler, or reembedding action.

Sanitized response shape:

```text
httpStatus: 200
ok: true
noDataFound: true
sourceCount: 0
generationLimited: false
errorFlag: false
forbiddenUiTerms: none
```

## Finding

The production backend currently returns the expected noData result for the fixture.

The earlier UI-QA noData screenshot is treated as inconclusive for the exact prompt execution because the captured UI did not visibly show the noData user prompt, while this recheck confirms the authenticated backend contract directly.

## Decision

Status: PASS

The noData boundary does not need an immediate production logic patch for this fixture.

Recommended follow-up:

- Keep the existing noData fixture tests.
- Improve the UI automation harness so each submitted prompt is visibly asserted before result capture.
- If future UI QA reports a noData mismatch, require prompt-visible evidence or a paired sanitized backend shape check.

## No-Touch Confirmation

This gate did not perform:

- Code changes
- RAGSearchService changes
- `/api/chat-ollama` changes
- DB/schema changes
- Reembedding or crawler execution
- Production SQL
- Source payload logging
- Cookie/token/session extraction
- Stage, commit, or push
