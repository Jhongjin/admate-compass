# Gate Compass-Auth-5 Post-Deploy Login Shell Smoke

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Production: `https://compass.admate.ai.kr`
Mode: read-only production smoke with one documentation artifact

## Goal

Verify that the Compass-local login shell shipped in commit `5c6cc30` is reflected in production and that no-session `/chat-ollama` users are sent to the Compass-local login route.

This smoke did not modify runtime code, RAGSearchService, `/api/chat-ollama`, database schema, import jobs, re-embedding jobs, crawler code, Vercel settings, or production deployment settings. No login form was submitted.

## Git And Deployment State

Git state:

- `HEAD`: `5c6cc30a5ac9cec87f30d54db70c5ed9ce0a4098`
- `origin/main`: `5c6cc30a5ac9cec87f30d54db70c5ed9ce0a4098`
- Latest origin commit: `5c6cc30 feat: add Compass local login shell`

Vercel metadata:

- Local `.vercel/project.json` points to project `admate-compass`.
- Vercel connected app project/deployment lookup returned `403 Forbidden` for the configured scope, so the latest production deployment commit could not be verified through the Vercel API in this gate.

Deployment inference:

- Production `/login` now renders the new Compass-local login shell.
- Production `/chat-ollama` no-session browser navigation redirects to `/login?next=/chat-ollama`.
- These production behaviors are specific to the `5c6cc30` implementation, so production appears to have picked up `5c6cc30` or a later commit.

## Production `/login`

HTTP check:

- URL: `https://compass.admate.ai.kr/login`
- Status: `200`
- Title: `AdMate Compass - Policy Intelligence Agent`

Browser visible copy check:

- `AdMate Compass 로그인`: pass
- `정책 검색을 이용하려면 AdMate 계정으로 로그인하세요`: pass
- `접근 권한이 없다면 이용 신청`: pass

Access request link:

- Visible link text: `접근 권한이 없다면 이용 신청`
- Link target: `https://sentinel.admate.ai.kr/access-request`

Note:

- The raw App Router HTML did not include the client-rendered copy directly, but the browser-rendered production snapshot did show all required visible copy.

## `/chat-ollama` No-Session Redirect

Browser smoke:

- Start URL: `https://compass.admate.ai.kr/chat-ollama`
- Final URL: `https://compass.admate.ai.kr/login?next=/chat-ollama`
- Title after redirect: `AdMate Compass - Policy Intelligence Agent`

Result:

- Pass. A no-session user is redirected to the Compass-local login shell rather than public root.

## Invalid `next` Sanitizer

Production pre-auth checks:

- `https://compass.admate.ai.kr/login?next=https%3A%2F%2Fevil.example.com`
  - HTTP `200`
  - no server `Location` redirect
  - no external redirect occurred in browser before form submit
  - raw HTML did not contain `evil.example.com`

- `https://compass.admate.ai.kr/login?next=%2F%2Fevil.example.com`
  - HTTP `200`
  - no server `Location` redirect
  - no external redirect occurred in browser before form submit
  - raw HTML did not contain `evil.example.com`

- `https://compass.admate.ai.kr/login?next=%2Fapi%2Fchat-ollama`
  - HTTP `200`
  - no server `Location` redirect
  - raw HTML did not contain `/api/chat-ollama`

Static sanitizer verification:

- `null` -> `/`
- `/chat-ollama` -> `/chat-ollama`
- `/chat-ollama?q=Meta 정책` -> `/chat-ollama?q=Meta+%EC%A0%95%EC%B1%85`
- `https://evil.example.com` -> `/`
- `//evil.example.com` -> `/`
- `/api/chat-ollama` -> `/`
- `javascript:alert(1)` -> `/`
- `/admin` -> `/`
- `/chat-ollama?token=abc&q=ok` -> `/chat-ollama?q=ok`

Result:

- Pass for static sanitizer behavior and production pre-auth navigation.
- Full post-login fallback redirect was not executed because this gate explicitly prohibited form submission.

## `/api/chat-ollama` Production Contract

Production API smoke:

- URL: `https://compass.admate.ai.kr/api/chat-ollama`
- Method: `POST`
- Status: `200`
- `response.schema`: `compass`
- `response.sources`: array present
- `sourcesCount`: `3`
- `noDataFound`: `false`
- `generationLimited`: `false`
- `message`: present
- `content`: present
- Top 3 source summaries:
  - source 1: title present, excerpt present, corpus `ollama_document_chunks`, retrieval method `hybrid`
  - source 2: title present, excerpt present, corpus `ollama_document_chunks`, retrieval method `hybrid`
  - source 3: title present, excerpt present, corpus `ollama_document_chunks`, retrieval method `hybrid`

Result:

- Pass. The Compass schema and verified source evidence contract are preserved.

## Required Local Verification

Completed:

- `npm run type-check`: pass
- `npm run build`: pass
- `npm run verify:harness`: pass
- `npm run check:secrets --if-present`: pass

Harness notes:

- RAG contract check passed.
- Fixture schema evaluation passed for 20 fixtures.
- Admin/debug surface check passed with the existing 25 review warnings.

## Outcome

Gate Compass-Auth-5 result: pass with one deployment metadata caveat.

Confirmed:

- Production login shell is live.
- Required Compass login copy is visible.
- `/chat-ollama` no-session users are redirected to `/login?next=/chat-ollama`.
- Invalid `next` values do not trigger pre-auth external redirect.
- The committed sanitizer maps invalid/external/API `next` values to `/`.
- `/api/chat-ollama` continues to return `schema=compass` and 3 source records.

Caveat:

- Vercel production deployment commit could not be read through the connected Vercel app due a `403 Forbidden` scope authorization response. Production behavior nevertheless matches the `5c6cc30` implementation.

## Next Gate Recommendation

`Gate Compass-Auth-6 post-deploy login shell closure report`

Recommended scope:

- Close Auth-1 through Auth-5 as a completed production login shell track.
- Record remaining backlog:
  - authenticated login success redirect QA with a test account
  - password reset/account route ownership
  - shared Agent Core account/profile integration
  - central cross-domain auth handoff design
  - product entitlement versus plain Supabase authentication audit
