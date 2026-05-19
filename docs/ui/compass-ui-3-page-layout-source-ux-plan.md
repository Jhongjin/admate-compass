# Compass-UI-3 Page Layout / Source UX Refresh Plan

Date: 2026-05-06

## Scope

Compass-UI-3 is a design and implementation-planning step only.

No code, RAG retrieval logic, API response contract, DB schema, data import, reembedding, crawler behavior, or production environment is changed in this step.

## Goal

Refresh the full `/chat-ollama` user-facing RAG workspace so it feels like an AdMate operational policy console, not a standalone dark chatbot.

The next implementation should preserve the current `/api/chat-ollama` contract while making the page easier to trust:

- ask policy questions quickly
- read generated or fallback answers in a quiet work surface
- inspect source evidence before trusting an answer
- understand generation-limited and no-data states without developer terminology
- keep long Korean policy answers and excerpts stable on desktop and mobile

## References

Primary local references:

- `docs/ui/compass-ui-1-refresh-plan.md`
- `docs/design/openclaw-theme-reference.md`
- `C:/Users/Administrator/projects/admate-docs/design/admate-platform-theme-recommendations-v1.md`

Theme interpretation:

- Openclaw gives the operational console frame.
- AdMate platform theme recommends Compass as `Mintlify + Notion + Linear`.
- Neuform is useful as a gallery for reusable layout moves and promptable UI patterns, but Compass should not become a template-driven marketing page.
- Pretext.js is not part of the immediate implementation. It can be evaluated later as a proof-of-concept for long Korean answer/source-card layout stability.

## Current State

### Primary Route

| Area | File | Current role |
| --- | --- | --- |
| Chat page shell | `src/app/chat-ollama/page.tsx` | Primary user-facing RAG workspace |
| Answer and source card | `src/components/chat/ChatBubble.tsx` | Message, answer, source list, feedback, no-data/contact states |
| Right evidence panel | `src/components/chat/RelatedResources.tsx` | Related resource/source cards based on current answer sources |
| Suggested questions | `src/components/chat/QuickQuestions.tsx` | Follow-up prompts in the right panel |
| History panel | `src/components/chat/HistoryPanel.tsx` | Past conversation access |
| Global shell | `src/components/layouts/MainLayout.tsx` | Header/nav wrapper used by `/chat-ollama` |

### Current Page-Level Friction

| Issue | Evidence | Why it matters |
| --- | --- | --- |
| Dark/gradient shell remains | `MainLayout`, `chatHeader`, loading state, input region, right panel | Compass should now read as an operational knowledge console |
| Split-pane behavior is useful but visually noisy | manual left/right resize, collapse buttons, gradient divider | Keep behavior, reduce visual weight |
| Right source panel is visually disconnected | cream/orange gradient in `chat-ollama/page.tsx` and decorative `RelatedResources` cards | Source evidence should feel part of the same trust surface |
| Loading state uses orange/pink bot motif | `chat-ollama/page.tsx` loading bubble | Should become neutral "검색 중 / 출처 확인 중" status |
| No-data and generation-limited state is fragmented | `ChatBubble` now has better copy, page/right panel still lacks a unified state model | The page should explain what is known, unknown, and still available |
| Internal fields are not normalized at page level | response has `retrievalMethod`, `sourceQuality`, `corpus`, scores | User-facing labels need one consistent mapping across answer and side panel |
| Long Korean excerpts can crowd cards | answer/source cards and right panel use dense text in flexible panes | Need stable line clamp, break-word, min-width, and mobile drawer behavior |

## Design Direction

### Visual System

Use the AdMate operational console baseline:

| Token | Value | Use |
| --- | --- | --- |
| App background | `#F7F7F7` | full page |
| Surface | `#FFFFFF` | chat canvas, source cards, input bar |
| Border | `#E5E5E5` | panel/card separation |
| Primary text | `#0D0D0D` | answer, titles |
| Secondary text | `#5E5E5E` | helper copy, metadata |
| Muted text | `#9A9A9A` | timestamps and subdued labels |
| Compass accent | `#5E6AD2` / `#ECEDF9` | info badge, active state |
| Verified source | `#177D4E` / `#EFFAF4` | evidence found |
| Limited evidence | `#9E5700` / `#FFF8EC` | generation-limited or weak metadata |
| Critical/no evidence | `#D93025` / `#FEF2F1` | noDataFound or failed request |

Shape:

- card radius: 8px or less by default
- panel radius: 8px only where the whole panel is framed
- use borders and spacing before shadows
- remove hover scale effects from operational controls
- avoid gradient buttons, glassmorphism, emoji labels, and decorative circles

### Information Architecture

Recommended desktop layout:

```text
--------------------------------------------------------------+
| 44px topbar: Compass / schema status / actions              |
+--------------------------------------------------------------+
| left rail or history drawer | main answer workspace | source |
| compact, optional           | question + thread     | panel  |
|                              | sticky input          |        |
+--------------------------------------------------------------+
```

Recommended page zones:

1. Topbar: product, coverage status, history/new-chat actions.
2. Main workspace: thread, answer status, input composer.
3. Evidence panel: current answer sources, source health, follow-up prompts.
4. Mobile: source panel becomes a drawer/tab below the answer, not hidden forever.

## Source UX Language

Keep internal fields out of the UI. Use these mappings consistently in `ChatBubble` and `RelatedResources`.

| Internal signal | User-facing label |
| --- | --- |
| `retrievalMethod=hybrid` | 의미+문구 일치 |
| `retrievalMethod=vector` | 의미 유사 |
| `retrievalMethod=keyword` | 문구 일치 |
| `sourceQuality.hasUrl=true` or `url` exists | 원문 확인 가능 |
| excerpt exists / `sourceQuality.hasExcerpt=true` | 원문 일부 확인 가능 |
| no source URL but valid excerpt | 관련 문서 |
| `sourceQuality.isFallback=true` | 일반 사용자 화면에서는 출처로 노출하지 않음 |
| `corpus=ollama_document_chunks` | 관련 문서 |
| `corpus=document_chunks` | Compass 문서 |
| `model=ollama-connection-failed` with sources | 답변 정리는 일시 제한, 출처 문서 확인 가능 |
| `noDataFound=true` | 현재 Compass 문서 기준으로 확인 가능한 출처 없음 |

Avoid:

- `retrievalMethod`
- `sourceQuality`
- `hybridScore`
- `corpus`
- `vector`
- raw model IDs
- debug JSON

## UX States

### Normal Answer With Sources

Page should show:

- answer card status: `출처 문서 확인`
- source count: `확인한 출처 3개`
- source cards ordered by rank
- concise score wording: `관련도 92%`, not `hybridScore`
- right panel mirrors the same source titles and excerpts

### Generation-Limited With Sources

This is the current production MVP fallback state when Ollama generation is unavailable.

User copy:

```text
답변 정리는 일시적으로 제한되었지만, 관련 출처 문서를 찾았습니다.
아래 출처 문서를 먼저 확인해 주세요.
```

Behavior:

- keep sources visible
- do not show an empty-answer error if sources exist
- do not hide the source panel
- keep model/error details out of normal UI
- optionally show a compact amber badge: `답변 정리 일시 제한`

### No Data Found

User copy:

```text
현재 Compass 문서 기준으로 확인 가능한 출처를 찾지 못했습니다.
플랫폼명, 상품명, 정책 항목을 조금 더 구체적으로 입력해 주세요.
```

Behavior:

- source panel should switch to guidance, not sample Meta resources
- show 3 query refinement examples
- avoid vendor-specific "Facebook team" wording
- keep contact/escalation as a secondary action

### Loading

Replace decorative bot typing with deterministic status steps:

```text
질문 분석 중
관련 문서 찾는 중
출처 문서 확인 중
답변 구성 중
```

Do not fake detailed progress. The steps can be static labels while the request is pending.

### Error

Use a red-tinted operational alert:

```text
요청 처리 중 문제가 발생했습니다.
출처 확인 상태를 확인한 뒤 다시 시도해 주세요.
```

If the API returns sources and only generation failed, use the generation-limited state instead of generic error.

## Proposed Implementation Phases

### Compass-UI-3A: Page Shell And Chat Workspace

Primary file:

- `src/app/chat-ollama/page.tsx`

Changes:

- restyle page background to `#F7F7F7`
- replace dark gradient `chatHeader` with light 44px-style topbar treatment
- keep existing history/new-chat/toggle actions
- replace orange/pink bot avatar in header/loading with neutral Compass icon treatment
- restyle input composer as a white bordered sticky surface
- keep textarea behavior and submit handlers unchanged
- keep split resize behavior but make divider neutral

Do not change:

- API request body
- response parsing
- message state shape unless only adding optional UI fields already present in response
- conversation save behavior
- auth redirect behavior

### Compass-UI-3B: Evidence Panel Refresh

Primary files:

- `src/app/chat-ollama/page.tsx`
- `src/components/chat/RelatedResources.tsx`

Changes:

- remove cream/orange gradient panel
- make right panel a white bordered evidence panel
- title: `확인한 출처`
- subtitle: `현재 답변에 사용된 출처 문서`
- show source count, verified/limited/no-data badge
- remove default sample resources when no sources exist on a real answer
- convert source cards to compact list rows:
  - title
  - excerpt line clamp
  - evidence label
  - source availability
  - open/download action
- keep QuickQuestions, but visually separate as `다음 질문 후보`

### Compass-UI-3C: Mobile Source Drawer

Primary file:

- `src/app/chat-ollama/page.tsx`

Changes:

- when right panel collapses below desktop, show a compact `확인한 출처 보기` button near the latest answer or input area
- reuse existing `Sheet` components if possible
- source drawer contains the same `RelatedResources` list
- avoid duplicating data transformation logic in multiple places

### Compass-UI-3D: Long Korean Text Stability

Primary files:

- `src/components/chat/ChatBubble.tsx`
- `src/components/chat/RelatedResources.tsx`
- optionally small page-level class changes in `src/app/chat-ollama/page.tsx`

Rules:

- apply `break-words`, `min-w-0`, and `overflow-hidden` to title/excerpt containers
- source title max 2 lines in right panel, no forced single-line truncation on main source cards
- excerpt max 4 lines in main answer sources, 3 lines in right panel
- preserve markdown readability with 13-14px body text
- keep lists compact but not cramped

Pretext.js candidate:

- Defer immediate adoption.
- Evaluate later only if long Korean policy answers still create awkward line breaks or overflow.
- PoC should be local-only and non-blocking:
  - compare native CSS line wrapping vs Pretext.js on 5 long Korean answer/source samples
  - check hydration risk in Next.js client components
  - check performance on 20+ source cards
  - do not introduce as a production dependency without a separate approval gate

## File Plan

### Likely To Edit In UI-3 Implementation

| File | Purpose | Risk |
| --- | --- | --- |
| `src/app/chat-ollama/page.tsx` | Full page shell, input composer, right panel, loading state | Medium because file has request/response logic mixed with UI |
| `src/components/chat/RelatedResources.tsx` | Evidence panel source list | Medium because it currently fabricates sample resources |
| `src/components/chat/ChatBubble.tsx` | Align source language and long-text stability with page shell | Low/medium because UI-2 already touched this file |
| `src/components/chat/QuickQuestions.tsx` | Optional styling only | Low |

### Do Not Edit For UI-3

| File/area | Reason |
| --- | --- |
| `src/lib/services/RAGSearchService.ts` | RAG logic out of scope |
| `src/app/api/chat-ollama/route.ts` | API contract out of scope |
| `docs/sql/*` | DB/data out of scope |
| `.env*` | secrets/env out of scope |
| crawler/import/reembedding scripts | data out of scope |
| admin/docs pages | user-facing chat refresh first |

## Dirty Worktree Caution

Before implementation:

- read `git diff -- src/app/chat-ollama/page.tsx`
- read `git diff -- src/app/page.tsx`
- preserve existing user or prior-agent changes
- stage only files changed for the approved UI gate
- do not include unrelated dirty files

`src/app/chat-ollama/page.tsx` is a likely implementation target and may already be dirty. Use focused patches and review staged diff before commit.

## Acceptance Criteria For UI-3 Implementation

Local checks:

- `npm run type-check`
- `npm run build`
- `npm run verify:harness`
- `npm run smoke:chat-ollama-local` when local env is available

Browser checks:

- `/chat-ollama` loads on desktop
- `/chat-ollama` loads on mobile width
- long Korean answer does not overflow
- source cards do not overflow
- source panel collapses cleanly
- input composer remains usable
- noDataFound copy is visible and vendor-neutral
- generation-limited with sources keeps sources visible

API contract checks:

- `/api/chat-ollama` still returns the existing response structure
- `sourcesCount >= 1` smoke still passes for known policy query
- `retrievalMethod` and `sourceQuality` remain in the API response but are not shown as raw labels in the UI

Production smoke after approved implementation:

- `https://compass.admate.ai.kr/chat-ollama` returns HTTP 200
- `https://compass.admate.ai.kr/api/chat-ollama` returns HTTP 200 for a known policy question
- production response remains `schema=compass`
- verified sources remain present even if generation is limited

## Risks

| Risk | Mitigation |
| --- | --- |
| `chat-ollama/page.tsx` mixes UI and logic | Style-only patches; avoid request/response code changes |
| Right panel currently creates sample resources | Separate empty-state behavior from real-source behavior |
| Mobile panel hidden too aggressively | Add drawer/tab access for latest sources |
| Long Korean text overflow | Use `min-w-0`, `break-words`, line clamp, stable card widths |
| Too much global CSS churn | Keep changes local to chat page/components first |
| Pretext.js hydration/performance risk | Keep as later PoC only |

## Recommended Next Approval

Use this approval phrase for implementation:

```text
Gate Compass-UI-3A page shell and evidence panel implementation을 승인한다.

기준 문서:
- docs/ui/compass-ui-3-page-layout-source-ux-plan.md

범위:
- src/app/chat-ollama/page.tsx
- src/components/chat/RelatedResources.tsx
- 필요 시 src/components/chat/ChatBubble.tsx, src/components/chat/QuickQuestions.tsx 스타일 보정

금지:
- RAGSearchService 수정 금지
- /api/chat-ollama response contract 변경 금지
- DB/schema/env/data 변경 금지
- crawler/reembedding/import 실행 금지
- unrelated dirty 파일 stage 금지

검증:
- npm run type-check
- npm run build
- npm run verify:harness
- npm run smoke:chat-ollama-local 가능하면 실행
- /chat-ollama desktop/mobile visual smoke
- production route/API smoke 가능하면 확인
```
