# Gate Compass-UI-QA-6

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: Read-only post-deploy production smoke
Scope: production `/chat-ollama` mobile layout after commit `9a027db`

## 1. Executive Summary

Production mobile layout smoke passed for the Compass authenticated chat shell.

After commit `9a027db`, production `/chat-ollama` keeps the desktop answer/source layout intact, while the mobile viewport no longer shows the history rail or desktop source/evidence panel as visible columns that push the answer/input out of view.

No query was submitted during this smoke. The noDataFound/RAG gating issue was intentionally not retested in this gate.

## 2. Git / Deployment State

### origin/main

- `origin/main`: `9a027db`
- local `HEAD`: `9a027db`
- latest commit: `9a027db fix: improve Compass mobile chat layout`

### Vercel production deployment

Vercel project metadata remains canonical:

- project name: `admate-compass`

The connected Vercel app could not list deployments in this session:

- result: `403 Forbidden`
- reason: Vercel scope authorization blocked access to the project scope

Conclusion:

The production deployment commit could not be confirmed through the Vercel API in this gate. Production page behavior was verified directly against `https://compass.admate.ai.kr`.

## 3. Authentication Boundary

Unauthenticated `/chat-ollama` browser navigation still follows the local login shell flow:

- requested URL: `https://compass.admate.ai.kr/chat-ollama`
- final URL: `https://compass.admate.ai.kr/login?next=/chat-ollama`
- login copy visible: yes

Authenticated smoke used a user-entered login session in an isolated browser profile. Password, token, cookie, session storage, and provider response values were not read or printed.

## 4. Desktop Layout Smoke

Viewport:

- width: `1440`
- height: `900`

Observed production DOM/layout:

- URL remained `/chat-ollama`
- horizontal overflow: `false`
- input textarea visible: yes
- input textarea within viewport: yes
- answer heading visible and within viewport: yes
- source/evidence heading visible and within viewport: yes
- history rail visible on desktop: yes
- mobile history trigger hidden on desktop: yes

Measured input bounds:

- left: `289`
- right: `1008`
- top: `816`
- bottom: `860`
- width: `719`
- height: `44`

Conclusion:

Desktop answer/input/source panel layout remains stable.

## 5. Mobile Layout Smoke

Viewport:

- width: `390`
- height: `844`

Observed production DOM/layout:

- URL remained `/chat-ollama`
- horizontal overflow: `false`
- document/client width: `390`
- input textarea visible: yes
- input textarea within viewport: yes
- answer heading visible and within viewport: yes
- history rail visible: no
- mobile history trigger visible and within viewport: yes
- desktop source/evidence heading visible on mobile: no

Measured input bounds:

- left: `8`
- right: `382`
- top: `772`
- bottom: `812`
- width: `374`
- height: `40`

Conclusion:

The mobile history rail and desktop source/evidence panel no longer occupy visible columns that push the answer/input out of the 390px viewport.

## 6. Long Korean Input Smoke

Method:

- inserted a long Korean prompt into the input field only
- did not press Enter
- did not submit a chat request

Observed:

- input value length: `135`
- input width: `374`
- input scrollWidth: `372`
- input clientWidth: `372`
- input horizontal overflow: `false`
- input within viewport: yes
- page horizontal overflow: `false`

Conclusion:

Long Korean input text does not create horizontal overflow in the mobile composer.

## 7. Local Verification

### `npm run type-check`

Pass

### `npm run build`

Pass

### `npm run verify:harness`

Pass with existing review warnings.

Observed summary:

- `check-rag-contract`: ok
- fixture evaluation mode: `fixture-schema`
- fixture count: `20`
- evaluated count: `20`
- `check-admin-debug-surface`: `ok (25 review warnings)`

The admin/debug warnings are known backlog items and were not part of this mobile layout gate.

## 8. Boundaries Preserved

Not changed or exercised:

- `RAGSearchService`
- `src/app/api/chat-ollama/route.ts`
- DB schema/import/reembedding/crawler
- noDataFound gating
- query/retrieval logic
- repeated fixture execution

## 9. Final Assessment

Status: Pass

The post-deploy authenticated smoke confirms the mobile layout fix is active in production behavior:

- desktop answer/source panel layout preserved
- mobile horizontal overflow removed
- mobile input remains visible within viewport
- source/evidence desktop panel does not push answer/input on mobile
- long Korean input remains contained

Follow-up:

- noDataFound/RAG gating remains a separate high-risk gate
- authenticated source panel content QA can continue separately with controlled fixtures
