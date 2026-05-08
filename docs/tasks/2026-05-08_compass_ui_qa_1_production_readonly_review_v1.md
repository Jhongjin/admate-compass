# Gate: Compass-UI-QA-1

## Product

AdMate Compass

## Repo/path

`D:\Projects\AdMate\admate-compass`

## Branch

`main`

## QA date

2026-05-08

## Routes checked

- `/`
- `/chat-ollama`
- production `/api/chat-ollama`

## Commands run

- `npm run type-check`
- `npm run build`
- `npm run verify:harness`
- production `GET /chat-ollama`
- production `POST /api/chat-ollama`
- source/UI forbidden copy scan
- production DOM snapshot and console inspection

## Production HTTP checks

- `GET https://compass.admate.ai.kr/chat-ollama`: `200`
- `POST https://compass.admate.ai.kr/api/chat-ollama` with source-found query:
  - `schema=compass`
  - `sourcesCount=3`
  - `noDataFound=false`
  - `model=ollama-connection-failed`
- `POST https://compass.admate.ai.kr/api/chat-ollama` with out-of-scope query:
  - `schema=compass`
  - `sourcesCount=0`
  - `noDataFound=true`
  - `model=vultr-ollama-no-data`

## Visual evidence

- Production `/` currently renders the old Meta FAQ-style landing page, not the newer Compass operational landing page.
- Production page title is still `Ad-Mate - AI-powered Meta advertising FAQ chatbot`.
- Anonymous production access to `/chat-ollama` redirects back to `/`.
- Production `/` triggers repeated `500` errors from `/api/admin/dashboard` and `/api/admin/status` in the browser console.

## Findings

### P0 blockers

1. Production UI is not aligned with the current Compass landing implementation.
   - Local source now defines Compass-specific metadata and a Compass operational home in [src/app/layout.tsx](/abs/path/D:/Projects/AdMate/admate-compass/src/app/layout.tsx:6) and [src/app/page.tsx](/abs/path/D:/Projects/AdMate/admate-compass/src/app/page.tsx:33).
   - Production still shows Meta FAQ branding, marketing-style feature cards, and dashboard/stat sections.
   - This fails Compass production tone consistency and evidence-first intent at the first screen.

2. Production root page is making repeated admin/status calls that return `500`.
   - Browser console repeatedly reports failures on `/api/admin/dashboard` and `/api/admin/status`.
   - This is consistent with the currently deployed root still using dashboard/status hooks rather than the simplified Compass landing.
   - Even if the user does not see raw error text, this is a production trust issue and likely UI drift from the intended build.

3. Evidence-first production UX cannot be visually validated on `/chat-ollama` for anonymous users because the route redirects to `/`.
   - Current source explicitly redirects unauthenticated users to `/` in [src/app/chat-ollama/page.tsx](/abs/path/D:/Projects/AdMate/admate-compass/src/app/chat-ollama/page.tsx:137).
   - This means answer card, source/evidence panel, and mobile chat-source interaction were not directly observable in production without authenticated access.

### P1 improvements

1. One internal-ish phrase remains in current chat UI copy: `Compass verified source`.
   - Present in [src/components/chat/RelatedResources.tsx](/abs/path/D:/Projects/AdMate/admate-compass/src/components/chat/RelatedResources.tsx:281).
   - This should be mapped to a Korean user-facing label in a later implementation gate.

2. Current source UI still uses `Compass 색인` / `정책 근거 색인` phrasing.
   - These are understandable, but slightly closer to internal indexing language than user trust language.
   - Worth revisiting after production drift is resolved.

3. `verify:harness` passes, but still reports review warnings for many debug/admin routes.
   - This is not a UI blocker by itself for this gate.
   - It remains a production hardening follow-up item.

### P2 notes

1. Current source code for `ChatBubble` and `RelatedResources` shows solid long-text safeguards.
   - `line-clamp`, `break-words`, `flex-wrap`, `min-w-0`, and bounded widths are present.
   - This suggests the intended chat/source UI is materially better than what is currently visible in production.

2. Current root implementation includes a stronger Compass tone and access-request path.
   - It references Sentinel access request and AdMate Home rather than a Meta-only FAQ narrative.
   - Production has not caught up.

## P0 blockers

- Production deployment drift: old Meta FAQ landing is still live.
- Production root console errors from admin/status endpoints.
- Anonymous production chat UI cannot be visually reviewed because `/chat-ollama` redirects to `/`.

## P1 improvements

- Replace `Compass verified source` with cleaner Korean user-facing trust wording.
- Revisit `Compass 색인` / `정책 근거 색인` copy after production alignment.
- Review whether generation-limited copy should mention "근거 문서는 보존되었습니다" more prominently in the answer card itself.

## P2 notes

- API behavior for `noDataFound` and generation-limited source preservation is consistent with the intended UX.
- Current chat/source component code appears mobile-conscious and long-text-safe, but production visual confirmation was blocked by auth redirect.

## No-touch areas confirmed

- No code changes to `RAGSearchService`
- No code changes to `/api/chat-ollama`
- No DB/schema/import/reembedding/crawler changes
- No dependency changes
- No commit or push

## Internal-term mapping result

- Pass:
  - Raw `retrievalMethod`, `sourceQuality`, `schema=compass`, and `sourcesCount` were not found as direct user-facing text in the current chat UI files.
  - Current UI maps retrieval modes to Korean labels such as `의미+문구 근거`, `문구 일치 근거`, `의미 유사 근거`.
- Partial:
  - `Compass verified source` remains user-facing English/internal-style wording.
  - `Compass 색인` and `정책 근거 색인` are acceptable but still somewhat internal-leaning.

## noDataFound result

- API result passes the safety requirement.
- Production `noDataFound` response is vendor-neutral and does not speculate about policy safety.
- Current message:
  - related information was not found in current documents
  - asks for a more specific question or different keywords

## Generation-limited/Ollama failure result

- API result passes the safety requirement.
- For source-found production queries, verified sources remain present even when generation fails.
- Production response shape correctly separates:
  - retrieval success with `sourcesCount=3`
  - generation failure with `model=ollama-connection-failed`
- Current source UI code also contains explicit generation-limited copy in:
  - [src/components/chat/ChatBubble.tsx](/abs/path/D:/Projects/AdMate/admate-compass/src/components/chat/ChatBubble.tsx:212)
  - [src/components/chat/RelatedResources.tsx](/abs/path/D:/Projects/AdMate/admate-compass/src/components/chat/RelatedResources.tsx:200)
- Direct production visual confirmation was blocked by anonymous redirect on `/chat-ollama`.

## Mobile text stability result

- Production root page mobile snapshot did not show obvious overflow or badge overlap on the old landing page.
- Current source chat components show good defensive layout patterns for long Korean text and source excerpts.
- Direct production mobile validation of answer card and source panel was not possible because `/chat-ollama` redirected to `/`.

## AdMate tone consistency result

- Fail on current production root.
- Production still presents as a Meta FAQ chatbot with marketing/feature-card emphasis.
- This does not match:
  - `AdMate Compass`
  - vendor-neutral platform scope
  - operational console tone
  - evidence-first trust posture

## Recommended next Gate

`Gate Design-Compass-Evidence-Implementation-1`

Recommended scope for the next gate:

- Resolve production deployment drift so the current Compass landing and metadata are actually live.
- Re-run production visual QA after authenticated access to `/chat-ollama` is available or a QA-safe session is provided.
- Replace remaining internal-style copy such as `Compass verified source`.
- Confirm root no longer calls failing admin/status surfaces in the public landing experience.

## Decision

`Blocked by P0 UI trust issue`

Reason:

- production landing is not the intended Compass production UI
- public root still behaves like an older Meta FAQ/dashboard surface
- chat evidence UX cannot be visually approved in production under anonymous access
