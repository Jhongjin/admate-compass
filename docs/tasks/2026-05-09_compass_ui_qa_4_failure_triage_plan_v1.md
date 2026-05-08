# Compass UI-QA-4 Failure Triage Plan v1

Date: 2026-05-09
Gate: Compass-UI-QA-4
Source gate: Compass-UI-QA-3C
Mode: planning only, no implementation

## Purpose

UI-QA-3C found two separate production QA failures:

1. The intentional noDataFound fixture still returned generic source evidence.
2. The authenticated `/chat-ollama` mobile layout pushed the answer/input area off-screen.

This plan separates the likely surfaces, read-only checks, and recommended fix order so the next gates do not mix a low-risk UI layout correction with a high-risk RAG/evidence gating change.

## Boundaries

Do not modify in this gate:

- `RAGSearchService`
- `src/app/api/chat-ollama/route.ts`
- DB schema
- import/reembedding/crawler jobs
- production settings
- code files

Do not re-run production queries in this gate.

## Failure 1: noDataFound

Fixture:

`화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘`

Observed result:

- Expected: vendor-neutral noDataFound state.
- Actual: generation-limited/additional-verification state with `근거 문서 3개`.
- Generic advertising policy evidence was attached to an impossible out-of-scope query.

### Likely Cause Candidates

1. Query intent allows the fixture as in-scope
   - The query includes strong in-domain terms: `광고`, `심사`, `기준`.
   - Static review shows `RAGSearchService.detectQueryIntent` treats ad/policy terms as domain signals and maps `심사` to review-type policy intent.
   - The out-of-scope parts, such as `화성`, `산소 농장`, and `3027년`, may not be sufficient to force `intent.isOutOfScope=true`.

2. Generic review/policy evidence can pass the evidence gate
   - `RAGSearchService.searchSimilarChunks` only returns no results early when `intent.isOutOfScope` is true or ranked results are empty.
   - `isVerifiedEvidence` can pass candidates with enough keyword/lexical/topic evidence, even if the scenario itself is impossible.
   - The fixture likely matched generic `광고` + `심사` + `기준` policy chunks.

3. `/api/chat-ollama` only treats zero verified sources as noDataFound
   - Static review shows `/api/chat-ollama` filters fallback/ungrounded results and returns `noDataFound: true` only when `verifiedSearchResults.length === 0`.
   - If any verified sources remain, the route returns `noDataFound: false`.
   - If Ollama generation fails after retrieval, the route intentionally preserves sources and returns `model: ollama-connection-failed`, not noDataFound.

4. UI noData display is probably not the primary failure
   - `ChatBubble` and `RelatedResources` already have visible noDataFound states.
   - In UI-QA-3C the UI displayed sources because the API response had sources and did not mark noDataFound.

### Surface Classification

Primary likely surface:

- `RAGSearchService` intent/evidence gating.

Secondary possible surface:

- `/api/chat-ollama` response policy, if product decides the route should apply an additional scenario-level noData guard after retrieval.

Least likely surface:

- UI components, because they appear to render noData states when `noDataFound=true` or sources are empty.

Fixture risk:

- The fixture may be too ambiguous for the current RAG domain classifier because it deliberately combines impossible nouns with valid policy words. It is useful as a stress test, but it should be handled in a RAG gate rather than a UI polish gate.

### Read-Only Checks Before Any Fix

Run only in a separately approved RAG/noData gate:

1. Inspect `detectQueryIntent` behavior for the exact fixture without calling production APIs.
2. Inspect whether `화성`, `산소 농장`, future year patterns, and impossible venue/product terms are represented in out-of-scope detection.
3. Review `docs/rag/rag-2-evaluation-fixtures.json` and related RAG fixture docs for existing `expectNoDataFound` cases.
4. Review `isVerifiedEvidence`, `isGenericPolicyIntent`, and generic topic rescue thresholds.
5. If query execution is approved in a future gate, run a single controlled local/API diagnostic and record only sanitized fields:
   - `noDataFound`
   - source count
   - source titles/vendors
   - retrieval method class
   - quality score bands
   - no raw provider response, tokens, cookies, or secrets.
6. Confirm whether the desired product behavior is:
   - impossible scenario + generic ad terms should noDataFound, or
   - generic ad-policy evidence can still appear with a stronger caveat.

### Change Risk

High.

Any change here can affect:

- RAG-3O 20/20 evaluation status
- source evidence preservation
- generic policy ranking
- API contract around `schema=compass`, `sourcesCount`, and verified sources

Recommended handling:

- Do not combine with UI layout work.
- Start with a read-only `Compass-RAG-QA-1 noDataFound fixture and evidence gate audit`.

## Failure 2: Mobile Layout

Observed result:

- At mobile width, the history rail remained visible.
- The answer/input column was displaced to the right.
- Source/evidence content appeared off-canvas or partially visible.
- The user could not reliably read the answer card or use the input area.
- UI-QA-3C evidence measured mobile overflow/displacement at a 390px client width.

### Likely Cause Candidates

1. History panel is rendered at all breakpoints
   - `/chat-ollama` renders the left history panel as `w-72` or `w-12` without a mobile breakpoint guard.
   - On a 390px viewport, `w-72` consumes most of the usable width before the chat column is laid out.

2. Chat panel width animation is desktop-oriented
   - The chat `motion.div` animates `width` to either `100%` or `${leftPanelWidth}%`.
   - This percentage is applied in a flex row that also contains the history panel.
   - On mobile, history width + percentage chat width can exceed the viewport.

3. Desktop source panel is hidden on mobile, but mobile evidence still lives inside the displaced chat column
   - The right source panel uses `hidden lg:flex`, so the desktop panel itself is not the main mobile offender.
   - The mobile `RelatedResources` block is rendered inside the chat column with `lg:hidden`.
   - Because the chat column is already pushed by the history rail, the mobile source/evidence block appears off-screen.

4. Missing mobile-specific shell state
   - There is no clear mobile default that collapses history, makes chat full-width, and exposes sources through an inline block, drawer, or modal.
   - The current state variables are shared across breakpoints and do not enforce mobile layout invariants.

### Priority Component Candidates

Primary:

- `src/app/chat-ollama/page.tsx`

Likely implementation focus in the next gate:

- Make the main chat shell mobile-first.
- Hide or collapse `HistoryPanel` below the `lg` breakpoint.
- Keep the answer/input column `w-full min-w-0` on mobile.
- Apply resizable `leftPanelWidth` and desktop three-panel behavior only at `lg` and above.
- Keep `RelatedResources compact` inside the mobile chat flow, or move it into a mobile source drawer.

Secondary:

- `src/components/chat/HistoryPanel.tsx`
  - Only if the panel itself needs a compact drawer/header treatment.

- `src/components/chat/RelatedResources.tsx`
  - Only if source cards need mobile-specific truncation or controls after the shell is fixed.

Avoid in the mobile gate:

- `RAGSearchService`
- `/api/chat-ollama`
- DB/reembedding/crawler changes

### Desktop Regression Guardrails

Desktop must keep:

- visible history panel behavior at desktop widths
- desktop source/evidence panel at `lg` and above
- panel collapse/expand action
- drag resize behavior
- answer card + source panel side-by-side at desktop
- no loss of source preservation during generation-limited state
- no horizontal overflow at 1280px, 1440px, and wide desktop

Mobile/tablet must guarantee:

- no horizontal displacement at 390px and 430px
- answer card visible without horizontal scrolling
- input composer fixed/visible within the viewport width
- history not consuming the main viewport by default
- source evidence reachable from the mobile answer flow
- long Korean text wraps within cards

## Priority Recommendation

### 1. Fix mobile layout first

Reason:

- It is a UI shell issue with a comparatively narrow blast radius.
- It can be handled in `src/app/chat-ollama/page.tsx` without touching RAG/API/DB.
- It unblocks authenticated visual QA for answer/source panel stability.
- The QA failure is deterministic from the saved screenshots and does not require additional production queries to plan.

Recommended next gate:

`Compass-UI-QA-4A mobile authenticated chat layout fix`

Allowed scope should be limited to:

- `src/app/chat-ollama/page.tsx`
- optionally `HistoryPanel` or `RelatedResources` only if needed for mobile layout

Validation should include:

- `npm run type-check`
- `npm run build`
- `npm run verify:harness`
- local responsive visual check at 390px, 430px, 768px, 1280px, and 1440px
- no `/api/chat-ollama` or RAG changes

### 2. Split noDataFound/RAG gating into a separate high-risk gate

Reason:

- The failure likely involves intent classification and evidence gating, not only presentation.
- Any change could disturb existing RAG evaluation and source quality tuning.
- It may require new deterministic diagnostics and fixture design before implementation.

Recommended next gate:

`Compass-RAG-QA-1 noDataFound fixture and evidence gate audit`

Initial mode:

- read-only
- no production mutation
- no DB/schema/import/reembedding/crawler changes
- no raw provider response output
- no query execution unless explicitly approved for that gate

### 3. Keep generation-limited/Ollama stability as a separate backlog item

Reason:

- UI-QA-3C confirmed source preservation during generation-limited state.
- Full answer-quality QA is still limited while generation repeatedly fails.
- This should not block the mobile shell fix.

Recommended backlog:

`Compass-Ollama-1 generation availability and fallback behavior audit`

## Proposed Gate Sequence

1. `Compass-UI-QA-4A mobile authenticated chat layout fix`
2. `Compass-UI-QA-4B mobile layout post-fix authenticated smoke`
3. `Compass-RAG-QA-1 noDataFound fixture and evidence gate audit`
4. `Compass-RAG-QA-2 noDataFound gating plan or fixture correction`
5. `Compass-UI-QA-5 authenticated answer/source panel re-smoke`

## Decision

Proceed with mobile layout first.

Hold noDataFound/RAG gating for a separate high-risk read-only gate before any implementation.
