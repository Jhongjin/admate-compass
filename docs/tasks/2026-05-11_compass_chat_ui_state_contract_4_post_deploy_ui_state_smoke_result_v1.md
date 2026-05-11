# Compass Chat UI State Contract 4 Post-Deploy UI State Smoke Result v1

Date: 2026-05-11
Status: docs-only result
Repo: `D:\Projects\AdMate\admate-compass`
Commit context: after `b2c518c89 docs: plan Compass chat UI state smoke`
Mode: production no-login boundary smoke plus offline synthetic contract check
Production URL source: prior repo task docs identify `https://compass.admate.ai.kr`

## Scope

This result records the safe post-deploy UI-state smoke for `/chat-ollama` under
the no-login boundary requested for Worker C1.

Allowed and performed:

- visited production `/chat-ollama` without logging in
- observed the no-session redirect/login shell only
- ran the offline synthetic Compass chat UI state contract checker
- wrote this docs-only result

Not performed:

- no login
- no production prompt submission
- no direct `/api/chat-ollama` request
- no production fixture execution
- no cookie, session storage, local storage, secret, or environment inspection
- no source, API, RAG, DB, fixture, package, or asset edits

## Deployment Context

Local git state at execution:

- `HEAD`: `b2c518c8963e3a32b66e63132c285e2af0dfef95`
- commit subject: `docs: plan Compass chat UI state smoke`

Production deployment commit was not independently verified through hosting
metadata in this gate. The smoke is therefore recorded as direct behavior
observed against the documented production URL after the local commit context.

## Production No-Session Smoke

Target:

- start URL: `https://compass.admate.ai.kr/chat-ollama`

Desktop-sized browser observation:

- final URL: `https://compass.admate.ai.kr/login?next=/chat-ollama`
- page title: `AdMate Compass - Policy Intelligence Agent`
- visible shell: Compass-local login shell
- visible copy included:
  - `AdMate Compass 로그인`
  - `정책 검색을 이용하려면 AdMate 계정으로 로그인하세요.`
  - `로그인 후 요청하신 Compass 화면으로 돌아갑니다.`
  - `접근 권한이 없다면 이용 신청`
- visible links included:
  - `Compass 홈`
  - `접근 권한이 없다면 이용 신청`
  - `Compass 홈으로 돌아가기`

Mobile-width browser observation at `390x844`:

- final URL remained `https://compass.admate.ai.kr/login?next=/chat-ollama`
- the same Compass-local login shell and copy were visible
- the protected chat shell, source panel, chat composer, and answer surface were
  not exposed before login

Result:

- no-login boundary: `PASS`
- `/chat-ollama` did not expose the authenticated chat UI without a session
- no production chat prompt or `/api/chat-ollama` smoke was executed

## UI State Matrix

| State | Result | Notes |
| --- | --- | --- |
| `initial-empty` | Blocked for production UI observation | Requires login or approved authenticated browser session. Not executed under this no-login boundary. |
| `source-found` | Blocked for production UI observation; covered offline | Requires approved non-production fixture or explicit approval for a production prompt. No production prompt submitted. |
| `noData` | Blocked for production UI observation; covered offline | Requires approved non-production fixture or explicit approval for a production prompt. No production prompt submitted. |
| `generation-limited` | Blocked for production UI observation; covered offline | Requires approved non-production fixture or explicit approval for a production prompt. No production prompt submitted. |
| `error` | Blocked for production UI observation; covered offline | Requires approved synthetic/non-production setup. No production failure was forced. |

## Offline Contract Check

Command:

```powershell
npm run check:compass-chat-ui-state-contract
```

Result: pass

Checker summary:

- fixture count: `10`
- states:
  - `initial-empty`: `1`
  - `source-found`: `3`
  - `noData`: `2`
  - `generation-limited`: `2`
  - `error`: `2`
- mobile states:
  - `source-found`: `1`
  - `noData`: `1`
  - `generation-limited`: `1`
  - `error`: `1`
- `productionApiCalled`: `false`
- `ragSearchExecuted`: `false`
- `browserUsed`: `false`
- `dbTouched`: `false`

## Tooling Note

The `agent-browser` CLI described by the local browser automation skill was not
available on PATH in this session. Browser observation used the available
Playwright MCP browser tools instead, limited to page navigation, viewport
resize, and accessibility snapshots. No form fields were filled or submitted.

## Boundary Confirmation

This gate did not change or exercise:

- `src/app/api/chat-ollama/route.ts`
- `RAGSearchService`
- production RAG retrieval, embeddings, generation, or fixtures
- database schema, migrations, import, crawler, or reembedding paths
- environment, cookies, local storage, or session storage
- package scripts or fixture files

## Final Assessment

Status: `PASS_WITH_BLOCKED_NON_INITIAL_STATES`

The no-session production boundary passed: `/chat-ollama` redirects to the
Compass-local login shell and does not expose authenticated chat UI before
login. All authenticated or non-initial UI states remain blocked for production
visual observation pending approved authenticated session and/or approved
non-production fixtures.
