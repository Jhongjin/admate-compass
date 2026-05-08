# Gate Compass-Production-3

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Mode: Read-only post-deploy production smoke
Scope: production root parity, public admin surface, and chat contract smoke after commit `a573099`

## 1. Executive Summary

Post-deploy production smoke shows a mixed result.

- Git and Vercel deployment parity are updated to commit `a573099`
- visible production root UI now renders the intended `AdMate Compass` landing
- public root no longer calls `/api/admin/dashboard`, `/api/admin/status`, or `/api/admin/users/check-admin`
- `/api/chat-ollama` still returns `schema=compass` and preserves `sources`
- `/chat-ollama` unauthenticated flow still returns to root

However:

- production root HTML `<title>` is still `Ad-Mate - AI-powered Meta advertising FAQ chatbot`
- raw server HTML still contains old copy signals and does not contain `AdMate Compass`

Conclusion:

`Gate Compass-Production-2` fixed the public root runtime surface and visible landing, but production metadata and server-rendered branding are not yet fully aligned.

## 2. Git / Deployment State

### origin/main

- `origin/main`: `a573099a1ae9ffd358b6673fe08e2fbced111496`

This matches the requested post-commit target.

### Vercel latest production deployment

Read-only `vercel inspect` logs show:

- repo clone: `github.com/Jhongjin/admate-compass`
- branch: `main`
- commit: `a573099`
- deployment status: `Ready`

Conclusion:

Vercel latest production deployment is on `a573099`.

## 3. Local Verification

### `npm run type-check`

Pass

### `npm run build`

Pass

### `npm run verify:harness`

Pass with review warnings.

Observed summary:

- `check-rag-contract`: ok
- fixture evaluation: `20/20`
- `check-admin-debug-surface`: `ok (25 review warnings)`

## 4. Production Root Smoke

### HTTP status

- `GET https://compass.admate.ai.kr/` -> `200`

### Raw HTML / title result

Production root raw HTML currently returns:

- title: `Ad-Mate - AI-powered Meta advertising FAQ chatbot`
- contains `Meta advertising FAQ chatbot`: yes
- contains `AI-powered Meta advertising FAQ chatbot`: yes
- contains `AdMate Compass`: no
- contains `Policy Intelligence Agent`: no

This means the initial server HTML and document title are still old-brand aligned.

### Visible browser-rendered root UI

Playwright root snapshot shows the visible production landing now renders:

- `AdMate Compass`
- `광고 플랫폼 정책과 가이드를 검색하고 답하는 Policy Intelligence Agent`
- `정책 질문하기`
- `문서 검색하기`
- `접근 요청`
- `AdMate 홈`
- `정책/플랫폼 카테고리`
- `최근 업데이트`
- `관리자 영역`

This means the user-visible root landing has moved to the new Compass landing.

## 5. Old Copy Smoke

### Old copy status in production root HTML/title

- `Meta advertising FAQ chatbot`: still exposed
- `Meta FAQ`: not directly detected in the fetched HTML
- `AI-powered Meta advertising FAQ chatbot`: still exposed

### Old copy status in visible root body

Playwright visible snapshot did not show old Meta FAQ landing copy in the root body. The user-facing root surface is the new Compass landing.

Conclusion:

Old brand copy is still present in metadata / initial HTML, but not in the visible hydrated root landing.

## 6. Public Root Admin Surface Smoke

### Browser network requests while loading root

Filtered Playwright network results on root showed:

- `/api/latest-update` -> `200`

Not observed:

- `/api/admin/dashboard`
- `/api/admin/status`
- `/api/admin/users/check-admin`

### Console state

- console warnings/errors: none observed for the root smoke run

Conclusion:

The public root admin/status surface removal appears successful.

## 7. `/api/chat-ollama` Contract Smoke

`POST https://compass.admate.ai.kr/api/chat-ollama`

Observed production response:

- HTTP `200`
- `response.schema = "compass"`
- `response.sources.length = 3`
- `response.noDataFound = false`
- top-level `model = "ollama-connection-failed"`

Conclusion:

Production chat contract still preserves Compass schema and sources under generation-limited conditions.

## 8. `/chat-ollama` Unauthenticated Flow

Browser smoke for unauthenticated `/chat-ollama` shows:

- initial `/chat-ollama` open starts on the chat route
- network then shows root `/?_rsc=...` requests
- resulting tab returns to `/`
- visible intermediate state includes `로그인 상태를 확인하는 중...`

Conclusion:

The existing unauthenticated redirect-to-root behavior remains in place.

## 9. Final Assessment

### Production deployment parity

Pass

Reason:

Vercel production deployment is on commit `a573099`.

### Visible Compass root landing

Pass

Reason:

The visible root UI now renders the intended `AdMate Compass` landing.

### Public root admin surface removal

Pass

Reason:

No runtime root calls were observed to `/api/admin/dashboard`, `/api/admin/status`, or `/api/admin/users/check-admin`.

### Production metadata / root HTML brand parity

Fail

Reason:

The production root `<title>` and raw HTML still expose old `Ad-Mate / Meta advertising FAQ chatbot` branding.

## 10. Recommended Next Gate

Recommended follow-up:

`Gate Compass-Production-4 metadata parity and server HTML brand cleanup`

That gate should focus narrowly on:

1. production document title parity
2. server-rendered root HTML branding parity
3. any remaining metadata source still emitting old `Ad-Mate / Meta FAQ` copy
