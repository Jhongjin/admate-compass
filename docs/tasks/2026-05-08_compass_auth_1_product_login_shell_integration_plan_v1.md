# Gate Compass-Auth-1

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Mode: Planning only
Scope: product login shell integration plan for AdMate Compass protected surfaces

## 1. Goal

Design a login flow for AdMate Compass that preserves product context when a no-session user tries to access protected screens.

This is a planning document only. No implementation is included in this gate.

## 2. Current Compass No-Session Behavior

Current protected chat behavior is implemented in [`src/app/chat-ollama/page.tsx`](D:/Projects/AdMate/admate-compass/src/app/chat-ollama/page.tsx).

Current behavior:

- `/chat-ollama` reads auth state through `useAuth()`
- while auth is loading, the page shows `로그인 상태를 확인하는 중...`
- when loading completes and `user` is absent, the page runs:

```text
window.location.href = '/'
```

Observed effect:

- a no-session user who opens `/chat-ollama` is returned to `/`
- any original protected path context is lost
- a query such as `/chat-ollama?q=...` is not carried into a login continuation flow

Related existing local auth surfaces:

- `src/components/layouts/MainLayout.tsx`
- `src/components/layouts/UserProfileDropdown.tsx`
- `src/components/layouts/AuthModal.tsx`
- `src/hooks/useAuth.ts`

The current Compass root already includes a user-facing note that answer generation may require login and points users to Sentinel access request when access is missing.

## 3. Problem Statement

### Product context loss

When a user enters a protected Compass route such as `/chat-ollama`, Compass sends them back to root without preserving the target route.

This creates a broken-feeling loop:

```text
I clicked a policy search/chat action
→ I landed back at the root
→ I do not know whether I need login, access approval, or a different path
```

### Login guidance is not product-specific enough

Current local modal copy is generic:

- `로그인`
- `회원가입`
- `채팅 기능을 사용하려면 먼저 로그인해주세요.`

For Compass, the protected action is not generic chat. It is policy search and evidence-backed RAG usage.

The login surface should say:

- this is AdMate Compass
- the user is trying to access policy search
- the next destination will be preserved
- missing access should use access request

### Cross-product auth boundary is unclear

Agent Core has canonical routes:

- `/login?next=<path>`
- `/reset-password`
- `/account`
- `/access-request`

Compass currently has local Supabase auth UI. The long-term product route should be aligned with Agent Core login, but cross-domain session behavior must be verified before replacing local auth entry points.

## 4. Recommended Flow

### Preferred target flow

For protected Compass routes:

```text
no-session /chat-ollama
→ Agent Core login with next
→ successful login
→ return to /chat-ollama or /chat-ollama?q=...
```

Example logical route:

```text
/login?next=/chat-ollama
```

For a query-backed question:

```text
/login?next=/chat-ollama%3Fq%3D...
```

The login host should be confirmed before implementation. If Agent Core login is served from `sentinel.admate.ai.kr`, the handoff would likely be:

```text
https://sentinel.admate.ai.kr/login?next=<encoded Compass path>
```

If Agent Core login is served from a separate auth domain, Compass should use that canonical host instead.

### Alternative flow: Compass-local login shell

Compass can keep a lightweight local shell that preserves product context, then hands off to Agent Core:

```text
no-session /chat-ollama
→ /login?next=/chat-ollama
→ Compass-branded login shell
→ Agent Core login handoff
→ successful login
→ next path
```

This option gives Compass a stronger product-specific explanation:

- `AdMate Compass 로그인`
- why login is needed
- how access request works
- where the user will return after login

Then Agent Core remains the source of login/account/reset behavior.

### Recommendation

Use the Compass-local login shell only if cross-domain login context needs explanation or if Agent Core login cannot easily display product-specific copy.

Otherwise, redirect directly to Agent Core login with a sanitized `next` parameter.

## 5. Cross-Domain / Session Considerations

Relevant domains:

- `compass.admate.ai.kr`
- `sentinel.admate.ai.kr`

Items to confirm before implementation:

- whether Supabase session cookies are scoped to each subdomain or shared across `.admate.ai.kr`
- whether Agent Core login writes a session Compass can read immediately
- whether post-login redirect from Sentinel or Agent Core back to Compass is allowed by auth provider redirect URL allowlists
- whether `next` may include a full Compass URL or must be a relative path
- whether `access-request` should live only on Sentinel or be reachable through Agent Core canonical routing

Preferred safety posture:

- keep Compass route authorization local
- let Agent Core own login, account, reset, and access request surfaces
- do not duplicate account lifecycle logic in Compass
- do not expose tokens, session values, or auth internals in user-facing copy

## 6. User-Facing Copy Direction

Recommended login shell copy:

```text
AdMate Compass 로그인
정책 검색을 이용하려면 AdMate 계정으로 로그인하세요.
로그인 후 요청하신 Compass 화면으로 돌아갑니다.
접근 권한이 없다면 이용 신청을 진행해주세요.
```

Recommended actions:

```text
AdMate 계정으로 로그인
이용 신청
Compass 홈으로 돌아가기
```

Recommended missing-access copy:

```text
Compass 접근 권한이 필요합니다.
정책 검색과 source evidence 확인을 이용하려면 이용 신청을 진행해주세요.
```

Avoid:

- generic `채팅 기능`
- raw auth/debug terms
- `schema`, `sourcesCount`, `retrievalMethod`, `sourceQuality`
- platform-specific blame language
- implying the user is allowed if access has not been confirmed

## 7. `next` Parameter Sanitization Principles

The `next` parameter must be treated as untrusted input.

Rules:

- allow only relative paths beginning with `/`
- reject absolute URLs such as `https://...`
- reject protocol-relative URLs such as `//example.com`
- reject backslash-based URL tricks
- decode once, normalize, then validate
- allow only known Compass paths for automatic return
- preserve query strings only after path validation
- fallback to `/` when invalid

Suggested allowlist:

```text
/
/chat-ollama
/history
```

Admin paths should not be accepted as public login redirect targets unless a later admin-auth gate explicitly approves them.

## 8. Implementation Candidate Files

Likely Compass files:

- `src/app/chat-ollama/page.tsx`
- `src/components/layouts/MainLayout.tsx`
- `src/components/layouts/UserProfileDropdown.tsx`
- `src/components/layouts/AuthModal.tsx`
- `src/hooks/useAuth.ts`

Optional new files if using a Compass-local shell:

- `src/app/login/page.tsx`
- `src/lib/auth/nextRedirect.ts`
- `src/lib/auth/agentCoreRoutes.ts`

Files that must remain untouched for this auth shell work:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- corpus SQL
- crawler
- embeddings / reembedding scripts
- DB schema and migration files

## 9. Test Plan

### Local checks

- `npm run type-check`
- `npm run build`
- `npm run verify:harness`

### No-session navigation

Test cases:

- `/chat-ollama`
- `/chat-ollama?q=Meta%20%EB%9E%9C%EB%94%A9%20URL`
- invalid `next=https://example.com`
- invalid `next=//example.com`
- invalid encoded external URL
- valid `next=/chat-ollama?q=...`

Expected:

- no-session user sees product-specific login context or is redirected to Agent Core login with preserved `next`
- invalid `next` falls back to `/`
- no source/evidence API is called until authenticated chat access is available

### Cross-domain auth smoke

After Agent Core login:

- user returns to Compass target route
- Compass `useAuth()` sees the session
- `/chat-ollama` initializes without bouncing back to `/`
- initial `q` parameter is processed once
- browser history does not keep sensitive or malformed redirect URLs

### Production smoke

After deployment:

- production `/` remains AdMate Compass landing
- production raw HTML title remains `AdMate Compass - Policy Intelligence Agent`
- `/chat-ollama` no-session behavior matches the chosen new flow
- `/api/chat-ollama` still returns `schema=compass` and preserves sources
- root still does not call `/api/admin/dashboard`, `/api/admin/status`, or `/api/admin/users/check-admin`

## 10. Next Gate Recommendation

Recommended next implementation gate:

```text
Gate Compass-Auth-2 no-session next redirect implementation
```

Suggested scope:

- replace `/chat-ollama` no-session redirect to `/`
- introduce sanitized `next` handling
- redirect to Agent Core login or a Compass-local login shell
- preserve `/chat-ollama?q=...`
- keep `/api/chat-ollama` and RAG retrieval untouched

Follow-up QA gate:

```text
Gate Compass-Auth-QA-1 authenticated chat/evidence visual QA
```

Suggested scope:

- authenticated `/chat-ollama`
- source/evidence panel
- mobile source panel
- long Korean answer/source card stability
- noDataFound and generation-limited states under authenticated session

## 11. Open Questions

Before implementation, confirm:

- authoritative Agent Core login host
- whether `sentinel.admate.ai.kr` is the login host or only the access request host
- Supabase cookie/session sharing policy across Compass and Sentinel domains
- allowed redirect URLs configured in the auth provider
- whether Compass should keep local sign-in/sign-up modals after Agent Core login is canonical
