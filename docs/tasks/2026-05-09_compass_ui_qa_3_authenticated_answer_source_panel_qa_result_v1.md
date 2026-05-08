# Compass UI-QA-3 Authenticated Answer/Source Panel Production QA Result v1

Date: 2026-05-09
Gate: Compass-UI-QA-3C
Target: https://compass.admate.ai.kr/chat-ollama
Mode: production read-only authenticated UI QA

## Scope

This QA verified the authenticated `/chat-ollama` answer and source/evidence surfaces after the Compass production root, metadata, admin surface, and local login shell work.

The session used the approved super_admin QA account `woolela@nasmedia.co.kr`. The password was entered directly by the user in an isolated browser session. No password, cookie, token, session value, raw provider response, or `.env` value was read or recorded.

This gate did not test ordinary user permission UX. That remains a separate gate.

## Execution Controls

- Browser profile: isolated temporary Chrome profile prepared in Gate Compass-UI-QA-3B.
- Login confirmation: user-confirmed "로그인 완료".
- Query limit: each fixture was submitted once.
- Source-found fixture was submitted once before the first CDP script stopped on a DOM evaluation exception. Its submitted state was confirmed from the page state and it was not repeated.
- No code files, RAG services, API routes, DB schema, import jobs, reembedding jobs, or crawlers were changed.
- No stage, commit, or push was performed.

## Fixtures

| Fixture | Query | Submission |
| --- | --- | --- |
| source-found | Meta 광고 소재에서 과장 표현과 랜딩 페이지 관련 주의사항을 알려줘 | 1회 |
| noDataFound | 화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘 | 1회 |
| 긴 한국어/정책성 | Meta, Google, Naver, Kakao에서 화장품 광고 소재를 운영할 때 플랫폼별 주의사항을 구분해서 설명해줘 | 1회 |

## Evidence

Screenshots are saved under:

`docs/tasks/evidence/2026-05-09_compass_ui_qa_3/`

Files:

- `desktop_source_found_answer_panel.png`
- `desktop_no_data_found.png`
- `desktop_long_korean_answer_panel.png`
- `mobile_long_korean_answer.png`
- `mobile_long_korean_sources.png`
- `mobile_390_long_korean_layout.png`

The screenshots are cropped to avoid exposing login credentials or session artifacts. They may show normal product UI state only.

## Result Summary

Overall verdict: blocked for production UI completion.

The authenticated desktop flow loads and preserves verified source cards even when generation is limited. However, the noDataFound fixture did not enter the expected noDataFound state, and the mobile `/chat-ollama` layout is not stable enough for production authenticated QA approval.

## Desktop Findings

### Source-found fixture

Status: pass with content-quality warning

- Answer card rendered.
- Source/evidence panel rendered.
- `근거 문서 3개` source state was visible.
- Generation-limited state appeared, but sources remained visible.
- No visible internal terms such as `retrievalMethod`, `sourceQuality`, `hybridScore`, `sourcesCount`, or `ollama_document_chunks` were detected.
- Old Meta FAQ branding was not visible.
- Page-level horizontal overflow was not observed on desktop.

Warning:

- The answer entered an additional-verification / generation-limited state instead of a fully generated answer. Source preservation passed, but answer quality should be revisited after the model connection/generation backlog is resolved.

### noDataFound fixture

Status: fail for noDataFound-state validation

- The fixture did not produce the expected vendor-neutral noDataFound state.
- The UI returned a generation-limited/additional-verification state with `근거 문서 3개`.
- Generic advertising policy evidence was still surfaced for the intentionally impossible Mars/3027 query.
- Therefore the actual noDataFound card/copy could not be approved from this run.

Risk:

- Retrieval/evidence gating may be over-matching generic ad-policy documents for impossible queries, or the fixture is not strict enough to trigger noDataFound under current ranking behavior.

### Long Korean / policy fixture

Status: partial pass on desktop, blocked by generation limit and source relevance

- Long Korean query was submitted once and the answer surface rendered.
- Source/evidence panel remained visible.
- Generation-limited state appeared, and verified sources remained preserved.
- Desktop card/panel text did not visibly overlap or break.
- No visible internal terms or old Meta FAQ copy were detected.

Warnings:

- The generated answer was limited, so full long-answer typography could not be completely validated.
- Source cards did not clearly show balanced Meta, Google, Naver, and Kakao coverage for the multi-platform question in the visible evidence set.

## Mobile Findings

Status: fail

The mobile viewport revealed a production layout issue:

- The conversation history rail remained visible and consumed the left side of the screen.
- The source/evidence panel remained visible to the right and pushed the answer/input area off-screen.
- The answer card was not reliably visible in the mobile viewport.
- The input area was partially visible at the far right rather than occupying a usable mobile layout.
- A 390px capture measured `documentElement.clientWidth=390`, `documentElement.scrollWidth=590`, and `body.scrollWidth=590`, indicating horizontal layout overflow from the user's perspective.

Impact:

- Mobile authenticated answer/source panel QA cannot be approved until the chat page uses a mobile-specific layout, such as collapsed history, full-width answer column, and a source drawer or modal.

## Generation-Limited / Ollama Failure State

Status: pass for source preservation, backlog for generation stability

Across all three fixtures, the UI showed generation-limited/additional-verification behavior. In those states:

- Source cards remained visible.
- Evidence metadata and relevance chips remained visible.
- The answer card did not collapse into an empty state.

Remaining risk:

- Repeated generation-limited outcomes reduce the value of authenticated answer QA because full answer typography and long-form answer quality cannot be fully assessed.

## Internal Copy Scan

No visible occurrence was detected in the authenticated UI for:

- `retrievalMethod`
- `sourceQuality`
- `hybridScore`
- `sourcesCount`
- `ollama_document_chunks`
- old Meta FAQ chatbot title/copy

AdMate Compass title/branding remained visible.

## Boundaries Preserved

The following areas were not modified:

- `RAGSearchService`
- `src/app/api/chat-ollama/route.ts`
- DB schema
- migration/import scripts
- reembedding jobs
- crawler logic
- production deployment settings

## Blockers Before Approval

1. Mobile `/chat-ollama` layout must be fixed so authenticated users can read answers and sources without horizontal displacement.
2. noDataFound behavior must be re-tested with a fixture that reliably triggers the vendor-neutral noDataFound state, or retrieval/evidence gating must be reviewed in a separate approved RAG gate.
3. Generation-limited/Ollama behavior should be stabilized or explicitly accepted as a fallback-only QA condition.

## Recommended Next Gates

1. `Compass-UI-QA-4 mobile authenticated chat/source panel fix plan`
   - Plan a mobile layout correction without touching RAG/API/DB.
2. `Compass-RAG-QA-1 noDataFound fixture and evidence gate review`
   - Read-only review first, because this touches retrieval behavior risk.
3. `Compass-UI-QA-5 authenticated visual re-smoke`
   - Re-run the same three fixtures after mobile layout and noDataFound conditions are addressed.

## Validation

- `git diff --check -- docs/tasks/2026-05-09_compass_ui_qa_3_authenticated_answer_source_panel_qa_result_v1.md`: pass
- `npm run type-check`: pass
- `npm run build`: pass
- `npm run verify:harness`: pass, with existing admin/debug surface review warnings count 25
- Staged files: none
- Existing dirty/untracked worktree items remain outside this gate and were not staged.
