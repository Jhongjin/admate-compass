# Gate Compass-Auth-3 Local Login Shell Implementation Plan

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Mode: planning only
Scope: Compass-local `/login` shell for protected Compass surfaces

## Goal

Plan a Compass-local login shell that works inside `https://compass.admate.ai.kr` and matches the current Compass Supabase session model.

This gate does not implement code. It defines the route, redirect, copy, sanitizer, test, and risk plan for the next implementation gate.

## Background

Auth-2 concluded that a direct Sentinel/Agent Core cross-domain login handoff is not ready for Compass protected chat access.

Key constraints from Auth-2:

- Compass currently checks login state through its own Supabase browser session.
- Sentinel/Agent Core `/login?next=` currently accepts only same-site relative `next` paths after login.
- A Sentinel-origin login session should not be assumed to authenticate Compass-origin client code.
- Direct `https://sentinel.admate.ai.kr/login?next=https://compass.admate.ai.kr/...` handoff is therefore risky and likely does not preserve the intended return path.

Recommended direction:

- Add a Compass-local `/login` shell.
- Use a same-origin sanitized `next` value.
- Keep access-request handoff separate until central auth or shared session behavior is explicitly designed.

## Current Behavior To Change

Current `/chat-ollama` no-session behavior:

```text
/chat-ollama
→ useAuth() resolves no user
→ window.location.href = '/'
```

Target behavior:

```text
/chat-ollama
→ useAuth() resolves no user
→ /login?next=/chat-ollama
→ login success
→ /chat-ollama
```

Invalid or unsafe `next` behavior:

```text
/login?next=https://example.com
→ reject next
→ login success returns to /
```

If the original Compass URL has an initial question:

```text
/chat-ollama?q=<question>
→ /login?next=/chat-ollama%3Fq%3D<question>
→ login success
→ /chat-ollama?q=<question>
```

The query preservation should be limited to safe Compass paths and should avoid forwarding credential-like parameters.

## Route Candidates

### `/login`

Primary route for this gate.

Responsibilities:

- Render a Compass-branded login shell.
- Read `next` from `searchParams`.
- Sanitize `next` as a same-origin Compass path.
- Use existing Compass Supabase sign-in behavior.
- Redirect to sanitized `next` after successful login.
- Fallback to `/` when `next` is missing or invalid.

Recommended initial implementation style:

- Client component page, because existing `useAuth()` and `AuthModal` behavior is client-side.
- Reuse existing `signIn` from `src/hooks/useAuth.ts` if practical.
- Avoid duplicating sign-up/account lifecycle beyond what is required for login.

### `/reset-password`

Do not implement in the first Auth-3 implementation gate unless strictly needed.

Options:

1. Link to existing Sentinel/Agent Core reset flow:
   - `https://sentinel.admate.ai.kr/reset-password`
2. Add a Compass-local reset shell later:
   - only after account/session ownership is clarified

Recommendation:

- For the first Compass-local login shell, include a secondary link or note only if product copy requires it.
- Do not create password reset logic in Compass yet.

### `/account`

Do not add Compass `/account` in this gate.

Account/profile ownership remains a follow-up topic because Compass currently has local auth UI but not the Agent Core account model.

Recommendation:

- Keep account/profile links out of the first login shell, or point users to the existing authenticated Compass dropdown after login.
- Handle shared account/profile integration in a later gate.

## User-Facing Copy

Primary title:

```text
AdMate Compass 로그인
```

Primary description:

```text
정책 검색을 이용하려면 AdMate 계정으로 로그인하세요.
```

Access guidance:

```text
접근 권한이 없다면 이용 신청
```

Optional support copy:

```text
로그인 후 요청하신 Compass 화면으로 돌아갑니다.
```

Avoid:

- generic `채팅 기능`
- raw internal terms such as `schema`, `sourcesCount`, `retrievalMethod`, `sourceQuality`
- Sentinel/Openclaw/Hermes/Admin implementation wording
- wording that suggests access is guaranteed before auth and authorization are confirmed

## Access Request Link Candidate

Candidate A: Sentinel access request

```text
https://sentinel.admate.ai.kr/access-request
```

Pros:

- Existing Agent Core canonical route.
- Already verified as a public route in prior gates.
- Keeps account/access lifecycle near Agent Core.

Cons:

- Sends the user out of Compass.
- Product context may be less Compass-specific unless the access request page supports product metadata later.

Candidate B: Home/AdMate access request

```text
https://home.admate.ai.kr/access-request
```

Pros:

- Better fit if AdMate Home owns cross-product access request UX.
- Can route users to the right product family without making Compass own account lifecycle.

Cons:

- Needs current route availability confirmation before implementation.
- May not yet connect to the same access-request backend.

Recommendation for the first implementation gate:

- Use `https://sentinel.admate.ai.kr/access-request` unless the user explicitly approves Home as the canonical access-request destination.
- Label the link in Compass copy as `이용 신청`, not as an internal product or admin route.

## Implementation Candidate Files

Allowed implementation files for the next gate:

- `src/app/login/page.tsx`
- `src/lib/auth/nextRedirect.ts` or `src/lib/auth/safeNext.ts`
- `src/app/chat-ollama/page.tsx`
- possibly `src/components/layouts/AuthModal.tsx` if the login shell reuses the existing form logic
- possibly `src/hooks/useAuth.ts` only if a small return-path helper is needed

Files to keep untouched:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- corpus SQL
- crawler code
- embedding/re-embedding code
- DB schema or migration files

## Next Sanitizer Helper Candidate

Proposed helper name:

```text
sanitizeCompassNextPath(value: unknown): string
```

Proposed location:

```text
src/lib/auth/safeNext.ts
```

Rules:

- Input is untrusted.
- Trim and length-limit the value.
- Decode only as needed through URLSearchParams behavior; avoid repeated decoding loops.
- Allow only values starting with `/`.
- Reject values starting with `//`.
- Reject absolute URLs such as `http://...` and `https://...`.
- Reject backslash-based URL tricks.
- Reject `/api` and `/api/...`.
- Allow only approved Compass destinations for automatic redirect.
- Preserve query strings only after the path is allowed.
- Fallback to `/`.

Initial allowlist:

```text
/
/chat-ollama
/history
```

Recommended default:

```text
/
```

Open question:

- Whether `/chat` should be included now or handled later, because this gate is focused on `/chat-ollama`.

## No-Session Redirect Candidate

Current target file:

```text
src/app/chat-ollama/page.tsx
```

Current behavior:

```text
window.location.href = '/'
```

Candidate behavior:

```text
const next = `${window.location.pathname}${window.location.search}`
window.location.href = `/login?next=${encodeURIComponent(next)}`
```

Implementation note:

- The login page must still sanitize `next`; the source redirect must not be trusted.
- If `q` is preserved, the login page redirects back to `/chat-ollama?q=...`, allowing existing initial-question handling to continue after `user` exists.

## Login Success Candidate

After successful sign-in:

```text
const safeNext = sanitizeCompassNextPath(searchParams.get('next'))
router.replace(safeNext)
```

Fallback:

```text
/
```

If a user opens `/login` while already logged in:

- Redirect to sanitized `next` if present.
- Otherwise redirect to `/chat-ollama` or `/`.

Recommendation:

- Use `/chat-ollama` as the already-authenticated default if the user arrived from a protected action.
- Use `/` as the invalid/missing next fallback.

## Test Plan

Static checks:

- `npm run type-check`
- `npm run build`
- `npm run verify:harness`
- `npm run check:secrets --if-present`

No-session redirect:

- Open `/chat-ollama` with no session.
- Confirm it redirects to `/login?next=/chat-ollama`.
- Open `/chat-ollama?q=<safe Korean question>` with no session.
- Confirm `next` preserves `/chat-ollama?q=...`.

Invalid next handling:

- `/login?next=https://example.com` returns to `/` after login.
- `/login?next=//example.com` returns to `/`.
- `/login?next=/api/admin/dashboard` returns to `/`.
- `/login?next=/admin` returns to `/` unless explicitly allowlisted later.

Visible login page copy:

- Confirm title contains `AdMate Compass 로그인`.
- Confirm body contains `정책 검색을 이용하려면 AdMate 계정으로 로그인하세요`.
- Confirm access guidance contains `접근 권한이 없다면 이용 신청`.
- Confirm no raw internal terms are visible.

Authenticated behavior:

- Existing authenticated `/chat-ollama` behavior remains unchanged except for no-session destination.
- Login success returns to same-origin safe `next`.
- The answer/source evidence UI is not modified.
- `/api/chat-ollama` schema and sources response behavior are not modified.

Regression checks:

- Root `/` remains public.
- `/chat-ollama` still shows the existing loading state while `useAuth()` is resolving.
- Sign-out behavior remains unchanged.
- Existing local `AuthModal` login from the header still works unless intentionally replaced.

## Risks

Duplicated auth UI:

- Compass-local `/login` may duplicate parts of `AuthModal`.
- Mitigation: extract only minimal shared form behavior later, after the route is proven.

Shared account/profile not integrated:

- Compass login may authenticate, but account/profile management remains split from Agent Core.
- Mitigation: keep account links out of this gate and plan a separate account integration gate.

Password reset route availability:

- Compass does not yet own `/reset-password`.
- Mitigation: link to Sentinel reset flow only after confirming it is the intended canonical path.

Authorization versus authentication:

- A valid Supabase session does not necessarily mean product entitlement.
- Mitigation: keep copy neutral and add an access-request path. Do not imply entitlement until authorization logic is audited.

Query preservation:

- Preserving `/chat-ollama?q=...` may carry user-entered question text through the URL.
- Mitigation: only preserve same-origin Compass query strings and avoid credential-like parameters.

Production parity:

- New `/login` route must match Compass production branding and not reintroduce old Meta FAQ copy.
- Mitigation: include forbidden-copy scan in the implementation gate.

## Recommended Next Gate

`Gate Compass-Auth-4 local login shell implementation`

Recommended scope:

- Add `src/lib/auth/safeNext.ts`.
- Add `src/app/login/page.tsx`.
- Change `/chat-ollama` no-session redirect from `/` to `/login?next=...`.
- Use existing Compass Supabase sign-in flow.
- Add targeted tests or lightweight route checks for `safeNext`.

Recommended implementation restrictions:

- Do not modify `src/app/api/chat-ollama/route.ts`.
- Do not modify `src/lib/services/RAGSearchService.ts`.
- Do not modify DB/schema/import/re-embedding/crawler code.
- Do not change production env or Vercel settings.

Recommended commit boundary:

- One implementation commit for the local login shell.
- A separate post-deploy smoke doc after Vercel production deploy completes.

## Verification For This Planning Gate

Required checks:

- `git diff --check -- docs/tasks/2026-05-08_compass_auth_3_local_login_shell_implementation_plan_v1.md`
- `npm run check:secrets --if-present`
- confirm staged files remain empty
