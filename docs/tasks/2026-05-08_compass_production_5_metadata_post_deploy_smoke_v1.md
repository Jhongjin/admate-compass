# Gate Compass-Production-5

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Mode: Read-only post-deploy production smoke
Scope: metadata, server HTML, visible root UI, public admin surface, and chat contract after commit `ad36224`

## 1. Executive Summary

Production metadata parity is now aligned.

After commit `ad36224`, production `https://compass.admate.ai.kr/` returns the Compass title in raw HTML, the visible browser UI renders the AdMate Compass landing, and the old Meta FAQ title/copy is no longer exposed in the fetched root HTML.

The public root still avoids admin/status bootstrap calls, and the Compass chat API still preserves the `schema=compass` response shape and verified sources under the current Ollama generation-limited state.

## 2. Git / Deployment State

### origin/main

- `origin/main`: `ad36224efc9d56ee37f7e3f13145ce49939067ab`

### Vercel production deployment

Read-only Vercel inspection showed:

- project: `admate-compass`
- target: production
- status: `Ready`
- deployment id: `dpl_77Z9mQTAEDad4Ykd77yc4FE5CWNm`
- created: `Fri May 08 2026 13:22:02 GMT+0900`

Filtered build logs showed:

- `Cloning github.com/Jhongjin/admate-compass (Branch: main, Commit: ad36224)`
- `Build Completed`
- `Deployment completed`

Conclusion:

Production is deployed from commit `ad36224`.

## 3. Local Verification

### `npm run type-check`

Pass

### `npm run build`

Pass

### `npm run verify:harness`

Pass with existing review warnings.

Observed summary:

- `check-rag-contract`: ok
- fixture evaluation: `20/20`
- `check-admin-debug-surface`: `ok (25 review warnings)`

The admin/debug review warnings are known residual production review items and were not part of this metadata smoke gate.

## 4. Production Root HTML Smoke

### HTTP status

- `GET https://compass.admate.ai.kr/` -> `200`

### Raw HTML title

- `<title>`: `AdMate Compass - Policy Intelligence Agent`

### Raw HTML copy scan

Fetched root HTML result:

- contains `AdMate Compass - Policy Intelligence Agent`: yes
- contains `AdMate Compass`: yes
- contains `Policy Intelligence Agent`: yes
- contains `Ad-Mate - AI-powered Meta advertising FAQ chatbot`: no
- contains `Meta advertising FAQ chatbot`: no
- contains `Meta FAQ`: no

Conclusion:

Raw HTML and document title now match Compass metadata.

## 5. Visible Root UI Smoke

Playwright production root snapshot confirmed visible UI includes:

- `AdMate Compass`
- `광고 플랫폼 정책과 가이드를 검색하고 답하는 Policy Intelligence Agent`
- `정책 질문하기`
- `문서 검색하기`
- `접근 요청`
- `AdMate 홈`
- `정책/플랫폼 카테고리`
- `최근 업데이트`
- `관리자 영역`

The visible page title in browser was:

- `AdMate Compass - Policy Intelligence Agent`

Conclusion:

Visible root UI and browser title are aligned with AdMate Compass branding.

## 6. Public Root Admin Surface Smoke

Filtered Playwright network requests during root load showed:

- `/api/latest-update` -> `200`

Not observed:

- `/api/admin/dashboard`
- `/api/admin/status`
- `/api/admin/users/check-admin`

Console:

- no warnings or errors observed during the smoke run

Conclusion:

The public root remains free of the previous admin/status bootstrap calls.

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

## 8. `/chat-ollama` Unauthenticated Redirect Smoke

Unauthenticated browser smoke for `/chat-ollama` showed:

- initial navigation to `/chat-ollama`
- route returned to `/`
- final page title: `AdMate Compass - Policy Intelligence Agent`
- root RSC requests observed during redirect

Conclusion:

The existing unauthenticated redirect-to-root behavior remains in place.

## 9. Final Assessment

### Production deployment parity

Pass

Reason:

Vercel production is deployed from commit `ad36224`.

### Raw HTML / title brand parity

Pass

Reason:

Raw root HTML now returns `AdMate Compass - Policy Intelligence Agent`.

### Old title/copy removal

Pass

Reason:

The old Meta FAQ title/copy strings were not detected in fetched root HTML.

### Visible root UI

Pass

Reason:

Playwright visible root snapshot shows the AdMate Compass landing.

### Public admin surface

Pass

Reason:

Root load did not call `/api/admin/dashboard`, `/api/admin/status`, or `/api/admin/users/check-admin`.

### Chat contract

Pass

Reason:

`/api/chat-ollama` preserved `schema=compass` and three verified sources.

## 10. Residual Notes

The Vercel aliases still include the legacy generated Vercel alias `jhongjin-admate-guide-codex.vercel.app`. The canonical production domain remains `https://compass.admate.ai.kr`, and the latest inspected production deployment is tied to `Jhongjin/admate-compass` on `main`.

The build and harness still surface known admin/debug review warnings, but those warnings are separate from this metadata parity gate.
