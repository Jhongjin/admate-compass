# Compass-UI-1 UI/UX Refresh Plan

Date: 2026-05-06

## Scope

Compass-UI-1 is a design and investigation step only.

No UI code, RAG logic, API contract, DB schema, production environment, document import, reembedding, or crawler behavior is changed in this step.

## Goal

AdMate Compass should feel like a trustworthy policy RAG tool within the AdMate ecosystem, aligned with Openclaw / Sentinel / Homepage rather than a standalone dark, decorative chatbot.

The RAG quality layer is now stable. The next work should make the user-facing experience clearer:

- ask a policy question quickly
- read the answer without visual noise
- inspect verified source evidence
- understand no-data / generation-failed states
- avoid developer terms in the user interface

## Reference Theme

Primary design reference:

- `docs/design/openclaw-theme-reference.md`

Openclaw theme traits:

- operational console, not marketing landing page
- light app background `#F7F7F7`
- white surfaces with border-first cards
- 8px to 12px radius
- small, dense, readable typography
- restrained status badges
- clear topbar/sidebar/page structure
- no raw JSON/debug terminology in normal user views

## Current Route Map

### User-facing routes

| Route | File | Role | Priority |
| --- | --- | --- | --- |
| `/` | `src/app/page.tsx` | Compass home / entry screen | P1 |
| `/chat-ollama` | `src/app/chat-ollama/page.tsx` | Primary production RAG chat | P0 |
| `/history` | `src/app/history/page.tsx` | Conversation history | P2 |
| `/chat` | `src/app/chat/page.tsx` | Older chat route using `/api/chat` | P3 / likely legacy review |

### Admin-facing routes

| Route | File | Role | Priority |
| --- | --- | --- | --- |
| `/admin` | `src/app/admin/page.tsx` | Admin dashboard | P3 |
| `/admin/docs` | `src/app/admin/docs/page.tsx` | Document upload / crawling / indexing management | P2 |
| `/admin/monitoring` | `src/app/admin/monitoring/page.tsx` | RAG/system monitoring | P3 |
| `/admin/stats` | `src/app/admin/stats/page.tsx` | Stats | P3 |
| `/admin/status` | `src/app/admin/status/page.tsx` | System status | P3 |
| `/admin/users` | `src/app/admin/users/page.tsx` | User management | P3 |
| `/admin/logs` | `src/app/admin/logs/page.tsx` | Logs | P3 |

### Test / internal routes

| Route | File | Recommendation |
| --- | --- | --- |
| `/test-ollama` | `src/app/test-ollama/page.tsx` | Keep out of primary nav |
| `/test-ollama-response` | `src/app/test-ollama-response/page.tsx` | Keep out of primary nav |
| `/test-railway` | `src/app/test-railway/page.tsx` | Keep out of primary nav |
| `/web-integration-dashboard` | `src/app/web-integration-dashboard/page.tsx` | Review separately |

## Current UI Structure

### Layouts

| File | Current state |
| --- | --- |
| `src/components/layouts/MainLayout.tsx` | Fixed header over a strong dark-to-purple-to-orange gradient. Large logo. Marketing/glass style. |
| `src/components/layouts/ChatLayout.tsx` | Dark gradient legacy chat shell with emoji nav labels. Likely not the primary Compass production route. |
| `src/components/layouts/AdminLayout.tsx` | Dark gradient admin shell with red/pink active states. More Sentinel-like than user view, but still more decorative than Openclaw. |

### Primary RAG UI

| File | Current state |
| --- | --- |
| `src/app/chat-ollama/page.tsx` | Main production chat UI. Handles `/api/chat-ollama`, history panel, right resource panel, split resizing, textarea, initial query param. |
| `src/components/chat/ChatBubble.tsx` | Renders answer markdown, source cards, contact/no-data option, confidence/model/processing time, feedback controls. |
| `src/components/chat/QuickQuestions.tsx` | Suggested question module in right panel. |
| `src/components/chat/RelatedResources.tsx` | Source/resource panel in right column. |
| `src/components/chat/HistoryPanel.tsx` | Conversation history panel. |

## Current UX Findings

### 1. Visual Theme Misalignment

Compass currently uses:

- dark global body background
- radial gradients
- purple/orange full-page gradient
- glassmorphism cards
- bright blue/orange/pink gradient avatars
- large logo treatments
- decorative shadows and hover scale effects

This conflicts with Openclaw/Sentinel/Homepage operational-console expectations:

- quieter background
- border-first surfaces
- compact controls
- less visual drama
- stronger information hierarchy

Relevant files:

- `src/app/globals.css`
- `src/components/layouts/MainLayout.tsx`
- `src/components/layouts/AdminLayout.tsx`
- `src/app/page.tsx`
- `src/app/chat-ollama/page.tsx`
- `src/components/chat/ChatBubble.tsx`

### 2. Home Screen Feels Like A Marketing Hero

`src/app/page.tsx` currently presents a large hero with dark background, motion, prominent badge, large title, and a glassy question card.

For a production Compass tool, the first screen should be more like a policy search console:

- compact topbar
- direct question box
- policy coverage status
- recent / suggested policy tasks
- source corpus status
- admin shortcut only for admins

The product name should stay visible, but not as a marketing landing-page hero.

### 3. Answer Card Does Not Separate Evidence State Clearly

`src/components/chat/ChatBubble.tsx` renders answer and sources, but the current source affordance is mostly "출처 N개 보기".

It does not clearly distinguish:

- verified source found
- source-only fallback because generation failed
- no policy evidence found
- internal fallback/mock source
- source with weak metadata
- source with URL vs source without URL

Developer terms should not be shown directly, but they should map into user-friendly labels.

Suggested user labels:

| Internal signal | User-facing label |
| --- | --- |
| `retrievalMethod=hybrid` | 본문과 의미가 함께 일치 |
| `retrievalMethod=vector` | 의미상 유사한 문서 |
| `retrievalMethod=keyword` | 문구가 직접 일치한 문서 |
| `sourceQuality.hasUrl=true` | 원문 확인 가능 |
| `sourceQuality.hasUrl=false` | 내부 색인 문서 |
| `model=ollama-connection-failed` with sources | 근거 문서는 찾았지만 생성 답변은 일시 제한 |
| `noDataFound=true` | 관련 정책 근거를 찾지 못함 |

### 4. Source Cards Are Too Decorative

Source cards currently use dark cards, gradients, circular numbered icons, many badges, and large spacing.

For policy trust, source cards should be denser:

- title
- platform/vendor badge
- evidence label
- excerpt
- source availability
- confidence/relevance in restrained wording
- open/download action

Avoid making the source card look like a decorative content tile.

### 5. No-data / Generation-failed States Need Product Language

Current no-data flow is partly Facebook-specific:

- "페이스북 담당팀에 문의"
- email request copy

Compass is now multi-vendor and source-verified. This should be generalized:

- no evidence: "현재 Compass 색인에서 관련 정책 근거를 찾지 못했습니다."
- generation failed but sources exist: "근거 문서는 찾았습니다. 생성형 답변은 일시적으로 제한되어 아래 근거를 먼저 확인하세요."
- contact/admin path should not imply only Facebook.

Relevant files:

- `src/components/chat/ChatBubble.tsx`
- `src/app/chat-ollama/page.tsx`

### 6. Right Panel Is Useful But Visually Split

`/chat-ollama` has a right panel with related resources and quick questions. It is useful, but current right panel uses a cream/orange gradient while the main chat is dark.

This creates a mixed product identity:

- dark/purple/orange chat
- cream/orange resource side panel
- Openclaw wants neutral light console

Recommendation: make the whole chat workspace a single operational console:

- left: history / saved questions
- center: question + answer
- right: evidence / recommended follow-up

For Compass-UI-1 implementation, keep layout behavior and resizing, but restyle surfaces.

### 7. Mobile Responsiveness

The chat page has responsive collapse logic:

- right panel collapses below `1024px`
- max bubble width uses `85%`
- textarea auto-resizes

Risk areas:

- fixed header plus chat content can create vertical crowding
- source cards are large and may overwhelm mobile
- right panel content is hidden rather than reintroduced as an evidence drawer/tab
- long Korean source titles may truncate too early

### 8. Accessibility / Readability

Current issues to review during implementation:

- white text on gradient background can have inconsistent contrast
- icon-only controls need clear labels/tooltips
- source toggle uses `▲/▼` text instead of a consistent icon
- emoji labels in old chat/admin surfaces are inconsistent
- hover scale animations are unnecessary for operational UI
- global body text is white, which conflicts with light Openclaw surfaces

## Design Direction

### Product Frame

Use an Openclaw-style application shell:

- app background: `#F7F7F7`
- topbar: 44px, sticky, light, border-bottom
- optional sidebar: 220px for primary navigation on desktop
- content max width: 1100 to 1280px
- white surfaces, border `#E5E5E5`
- card radius 8px
- primary action: black button
- info badge: purple light
- normal/source verified badge: green
- warning/no generation badge: amber
- error/no evidence badge: red

### Information Hierarchy

The UI should answer three questions quickly:

1. What policy question did I ask?
2. What answer can Compass provide?
3. Which source documents support it?

Recommended answer module order:

1. answer status strip
2. answer body
3. evidence summary row
4. source cards
5. follow-up questions
6. feedback

### User-friendly Evidence Labels

Avoid raw terms:

- Do not expose `retrievalMethod`, `sourceQuality`, `hybridScore`, `vectorScore`, `keywordScore` as-is.
- Convert to readable labels:
  - "강한 근거"
  - "문구 일치"
  - "의미 유사"
  - "원문 링크 있음"
  - "내부 색인 문서"
  - "생성 답변 제한"

Keep raw metadata available only in diagnostics/admin surfaces.

## Proposed UI Work Packages

### Compass-UI-2: App Shell And Home Refresh

Scope:

- `src/components/layouts/MainLayout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`

Tasks:

- replace dark gradient shell with Openclaw light operational shell
- reduce logo scale
- convert hero into compact policy query console
- show product status / coverage / primary actions in restrained cards
- keep admin shortcuts conditional

Risk:

- global body change can affect admin and legacy routes.
- mitigate with scoped `.compass-shell` classes or route-specific wrappers first.

### Compass-UI-3: Chat Workspace Refresh

Scope:

- `src/app/chat-ollama/page.tsx`
- `src/components/chat/HistoryPanel.tsx`
- `src/components/chat/QuickQuestions.tsx`
- `src/components/chat/RelatedResources.tsx`

Tasks:

- convert chat background to light workspace
- make input composer a stable bottom panel or compact card
- keep current API call and history behavior unchanged
- convert right panel into evidence/follow-up panel with neutral cards
- remove orange/pink visual language

Risk:

- resizing logic is stateful and should not be rewritten in same pass.
- keep functional logic untouched; only classes/layout wrappers.

### Compass-UI-4: Answer And Source Trust UI

Scope:

- `src/components/chat/ChatBubble.tsx`

Tasks:

- restyle answer bubble as a white bordered answer card
- add source status strip:
  - verified sources found
  - source-only fallback
  - no evidence
- redesign source cards as dense evidence rows
- map internal source metadata to user labels
- preserve source URLs/download actions
- replace Facebook-specific contact wording with vendor-neutral Compass wording

Risk:

- source object type currently omits many RAG-2/RAG-3 metadata fields even though API may return them.
- extend UI type only; do not change API response contract.

### Compass-UI-5: Admin Docs Light Pass

Scope:

- `src/components/layouts/AdminLayout.tsx`
- `src/app/admin/docs/page.tsx`
- `src/components/admin/DocumentUpload.tsx`
- `src/components/admin/GroupedDocumentList.tsx`
- `src/components/admin/EmbeddingHealthDashboard.tsx`

Tasks:

- align admin shell with Openclaw sidebar/topbar
- keep document upload/indexing flows unchanged
- reduce dark gradient/red-pink active style
- make status badges match Openclaw normal/warning/error/info colors

Risk:

- admin routes have more operational actions; visual-only changes must avoid event handler churn.

## Priority

| Priority | Work | Why |
| --- | --- | --- |
| P0 | Chat answer/source trust UI | Directly affects RAG credibility |
| P1 | Chat workspace shell/input | Most-used production route |
| P1 | Home query console | First impression and entry flow |
| P2 | No-data / generation-failed states | Prevents confusion while Ollama endpoint remains MVP backlog |
| P2 | History/recent questions | Useful but secondary |
| P3 | Admin docs/admin shell | Important, but user-facing RAG experience comes first |
| P4 | Legacy/test routes | Review after primary UI stabilizes |

## Files To Modify In First Implementation

Recommended first implementation should be narrow:

1. `src/components/chat/ChatBubble.tsx`
2. `src/app/chat-ollama/page.tsx`
3. optionally `src/components/chat/RelatedResources.tsx`

Reason:

- most visible user-facing RAG experience
- avoids global CSS risk
- preserves home/admin scope for a second pass

## Files To Avoid Initially

Avoid in Compass-UI-2/3 first pass unless necessary:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- `src/lib/supabase/*`
- `docs/sql/*`
- migration/import scripts
- crawler/reembedding scripts
- `.env*`

Also avoid broad `src/app/globals.css` rewrites in the first code pass. The global body currently controls many old surfaces; changing it early can create wide visual regressions.

## Suggested Visual Model

### Chat Page

```text
--------------------------------------------------------------+
| Compass | Policy RAG | Corpus: compass | Admin / Profile    |
+--------------------------------------------------------------+
| History        | Answer workspace                 | Evidence |
|                |                                  |          |
| Recent Q       | Question card                     | Sources  |
| Saved Q        | Answer card                       | Followup |
|                | Verified source strip             |          |
|                | Composer                          |          |
+--------------------------------------------------------------+
```

### Answer Card

```text
[근거 확인됨] [출처 3개] [생성 답변 제한 시에도 근거 유지]

Answer body...

근거 문서
1. 카카오 광고 심사 가이드      [문구+의미 일치] [원문 확인 가능]
   excerpt...
2. 네이버 광고 가이드: 운영정책 [문구 일치] [내부 색인 문서]
   excerpt...
```

## Validation Plan For Implementation

Run after UI implementation:

- `npm run type-check`
- `npm run build`
- `npm run verify:harness`
- `npm run smoke:chat-ollama-local`
- `npm run evaluate:rag-fixtures -- --run` if source metadata display logic is touched

Manual/browser checks:

- `/`
- `/chat-ollama`
- `/chat-ollama?q=광고%20소재에%20가격이나%20할인율을%20표시할%20때%20기준은?`
- no-data question: `내일 서울 날씨 알려줘`
- generation-failed production-like response with sources preserved
- mobile width around 390px
- desktop width around 1440px

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Global CSS rewrite affects admin/legacy pages | High | Start with route/component-level classes |
| Source metadata fields differ between endpoints | Medium | Defensive optional reads and user-label mapping |
| Dark-to-light conversion breaks contrast | Medium | Use Openclaw tokens and test answer/source states |
| Fixed header and chat height clash on mobile | Medium | Validate 390px width and scroll behavior |
| Admin upload flow disturbed | High | Keep admin route out of first pass |
| User-facing labels overpromise source quality | Medium | Use restrained labels like "근거 문서", not "검증 완료" unless source is non-fallback with excerpt |

## Implementation Approval Prompt

```text
Gate Compass-UI-2 chat trust UI implementation을 승인한다.

기준 문서:
- docs/ui/compass-ui-1-refresh-plan.md

목표:
- /chat-ollama의 답변 카드, 근거 source 카드, noDataFound/generation-failed 상태를 Openclaw/Sentinel 운영 콘솔 톤으로 정리한다.
- API response contract와 RAG 검색 로직은 변경하지 않는다.
- sourceQuality/retrievalMethod 같은 개발자 용어는 사용자 친화 문구로 매핑한다.

우선 수정 후보:
- src/components/chat/ChatBubble.tsx
- src/app/chat-ollama/page.tsx
- 필요 시 src/components/chat/RelatedResources.tsx

금지:
- DB schema 변경 금지
- RAGSearchService 수정 금지
- API route contract 변경 금지
- production env 변경 금지
- crawler/reembedding/import 실행 금지
- broad globals.css rewrite 금지
- unrelated dirty 파일 포함 금지

검증:
- npm run type-check
- npm run build
- npm run verify:harness
- npm run smoke:chat-ollama-local
- 가능하면 desktop/mobile browser visual check

완료 후 변경 파일, 검증 결과, production 영향 여부, rollback 방법을 보고해라.
```
