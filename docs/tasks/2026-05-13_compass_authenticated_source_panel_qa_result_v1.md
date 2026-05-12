# Compass Authenticated Source Panel QA Result

Date: 2026-05-13 KST

## Scope

This gate rechecked the authenticated `/chat-ollama` answer/source panel flow in production using a user-entered browser login session.

No cookie, token, session value, raw provider response, database row, or secret value was read or recorded.

## Evidence

Sanitized screenshots were saved under:

`docs/tasks/evidence/2026-05-13_compass_authenticated_source_panel_qa/`

- `desktop-source-found-redacted.png`
- `desktop-nodata-redacted.png`
- `desktop-long-policy-redacted.png`
- `mobile-long-policy-redacted.png`

Raw local screenshots were used only to produce the sanitized evidence set and are not required for commit.

## Fixtures

### Source-found

Prompt:

`Meta 광고 소재에서 과장 표현과 랜딩 페이지 관련 주의사항을 알려줘`

Result: PASS with generation-limited response.

The answer card showed a generation-limited state, but the source/evidence panel preserved 3 Compass source documents. This matches the current contract that source evidence remains visible when answer generation is limited.

### noDataFound

Prompt:

`화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘`

Result: FAIL.

The flow did not switch to a no-data state. It returned a generation-limited answer state with 3 generic source documents. This should be treated as a production policy/gating follow-up, not as a source panel rendering failure.

### Long Korean Policy Prompt

Prompt:

`Meta, Google, Naver, Kakao에서 화장품 광고 소재를 운영할 때 플랫폼별 주의사항을 구분해서 설명해줘`

Result: PASS with generation-limited response.

The answer card stayed readable and the source/evidence panel preserved 3 Compass source documents.

## Mobile Layout

Viewport: 390 x 844

Result: PASS.

Observed values:

- Horizontal overflow: none (`scrollWidth=390`, `innerWidth=390`)
- Input remained inside the viewport
- Source/evidence content did not push the answer/input off-screen

## Internal Term Exposure

Result: PASS.

The following internal terms were not observed in the rendered UI:

- `retrievalMethod`
- `sourceQuality`
- `hybridScore`
- `sourcesCount`
- `ollama_document_chunks`

## Production Behavior Notes

All 3 fixtures were executed once in the authenticated production UI session. The generation-limited state was observed for all executed prompts.

The noDataFound fixture remains the only blocking behavior from this QA pass.

## No-Touch Confirmation

This gate did not perform:

- code changes
- RAGSearchService changes
- `/api/chat-ollama` changes
- DB/schema/import/reembedding/crawler changes
- SQL execution
- production data mutation
- cookie/token/session inspection

## Next Gate

Recommended next gate:

`Gate Compass-NoData-9 production noData regression investigation`

The goal should be to determine why the previously expected future/impossible noData boundary still returns generic source documents for the authenticated Korean fixture in production.
