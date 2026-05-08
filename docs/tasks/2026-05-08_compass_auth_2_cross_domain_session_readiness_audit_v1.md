# Gate Compass-Auth-2 Cross-Domain Session Readiness Audit

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Mode: read-only audit with one documentation artifact

## Purpose

Before implementing a product login flow for AdMate Compass, this audit checks whether Compass can safely hand unauthenticated users to Agent Core login while preserving product context, return path, and session continuity across:

- `https://compass.admate.ai.kr`
- `https://sentinel.admate.ai.kr`

This audit did not modify Compass runtime code, RAG search code, `/api/chat-ollama`, database schema, import jobs, re-embedding jobs, or crawler code.

## Summary Judgment

Directly redirecting Compass users to Sentinel/Agent Core login with an external `next=https://compass.admate.ai.kr/...` return URL is not ready.

The current Agent Core login implementation intentionally accepts only same-site relative `next` paths. That is good for open redirect safety, but it means Sentinel login is not currently a cross-product return handoff for Compass. Separately, Compass checks its own Supabase browser session from the Compass origin, so a session established on `sentinel.admate.ai.kr` should not be assumed to authenticate `compass.admate.ai.kr` unless a shared cookie/session contract is explicitly implemented and verified.

Recommended next step: implement a Compass-local product login shell first, with a same-origin sanitized `next` value, and keep Sentinel/Agent Core handoff limited to access request or future SSO work.

## Current Compass No-Session Behavior

Current implementation:

- File: `src/app/chat-ollama/page.tsx`
- Auth hook import/use: line 22 and line 48
- No-session redirect: line 141
- Initial question handling: line 146 onward

When `useAuth()` resolves with no user, `/chat-ollama` performs a client-side redirect to `/`.

Observed effect:

- Protected product context is lost.
- The user is sent back to the public Compass root instead of a login screen.
- If the user arrived with `q=<question>`, that initial question is only processed after `user` exists, so the current no-session redirect path does not preserve an obvious return flow for the protected chat entry.

Related note:

- `src/app/chat/page.tsx` has a similar root redirect pattern, but the current gate target is `/chat-ollama`.

## Current Login Route Ownership

Compass does not currently have an app route named `/login`.

Compass auth UI is currently local modal based:

- `src/components/layouts/MainLayout.tsx` mounts `AuthModal`.
- `src/components/layouts/UserProfileDropdown.tsx` dispatches `openAuthModal` for login/signup.
- `src/components/layouts/AuthModal.tsx` calls Compass `useAuth()` sign-in/sign-up handlers.

Agent Core/Sentinel owns the canonical login pages:

- Repo inspected: `D:\Projects\AdMate\admate-agent-core`
- Login page: `src/app/login/page.tsx`
- Access request page: `src/app/access-request/page.tsx`
- Reset password page: `src/app/reset-password/page.tsx`
- Account page: `src/app/account/page.tsx`
- Proxy auth redirect: `src/proxy.ts`

Production route checks:

- `https://sentinel.admate.ai.kr/login?next=%2Fchat-ollama` returned HTTP 200 with title `AdMate Sentinel`.
- `https://sentinel.admate.ai.kr/login?next=https%3A%2F%2Fcompass.admate.ai.kr%2Fchat-ollama` returned HTTP 200 with title `AdMate Sentinel`.
- `https://sentinel.admate.ai.kr/account` returned HTTP 307 to `/login?next=%2Faccount`.

Interpretation:

- Sentinel login is publicly reachable.
- Protected Sentinel/Agent Core pages redirect to Sentinel `/login?next=<relative path>`.
- The login page may load with an external `next` query string, but the current client-side post-login sanitizer does not allow external destinations.

## Agent Core `next` Handling

Agent Core proxy behavior:

- File: `D:\Projects\AdMate\admate-agent-core\src\proxy.ts`
- Public paths include `/`, `/login`, `/reset-password`, and `/access-request`.
- Protected page requests are redirected to `/login`.
- The proxy sets `next` from the current same-origin pathname and search string.

Agent Core login behavior:

- File: `D:\Projects\AdMate\admate-agent-core\src\app\login\page.tsx`
- The login page reads `next` from `window.location.search`.
- It treats `next` as safe only when:
  - it starts with `/`
  - it does not start with `//`
  - it does not start with `/api`
- Otherwise it falls back to `/settings`.

Security implication:

- The current login page mitigates a simple open redirect through `next=https://...`.
- It also rejects protocol-relative `//host` targets.
- It does not currently provide an allowlisted external return contract for Compass.

Product implication:

- A Compass redirect to `https://sentinel.admate.ai.kr/login?next=https%3A%2F%2Fcompass.admate.ai.kr%2Fchat-ollama` would not return to Compass after login under the inspected source behavior.
- It would fall back to a Sentinel/Agent Core same-site path.

## Compass Session Model

Compass browser auth:

- `src/hooks/useAuth.ts` calls `supabase.auth.getSession()`.
- It subscribes with `supabase.auth.onAuthStateChange(...)`.
- It performs local `signInWithPassword`, `signUp`, and `signOut` through the Compass Supabase client.
- `src/lib/supabase/client.ts` creates a Supabase browser client from Compass public Supabase environment variables.

Compass server/service clients:

- `src/lib/supabase/server.ts` uses `createServerClient` with the service role key for server-side operations.
- `src/lib/supabase/compass.ts` includes Compass schema-aware service and browser clients.

Readiness finding:

- Compass currently determines login state from its own origin and its own Supabase client.
- This audit did not read or print environment variable values, so it does not confirm whether Compass and Agent Core point to the same Supabase project.
- Even if both apps use the same Supabase project, browser storage and default cookies should be treated as origin/host scoped unless shared cookie options are explicitly configured.

## Agent Core Session Sharing Readiness

Agent Core auth clients:

- `D:\Projects\AdMate\admate-agent-core\src\lib\supabase\client.ts` uses `createBrowserClient`.
- `D:\Projects\AdMate\admate-agent-core\src\lib\supabase\server.ts` uses `createServerClient`.
- `D:\Projects\AdMate\admate-agent-core\src\proxy.ts` uses `createServerClient` and writes cookies using the Supabase-provided cookie options.

Search result:

- No explicit `sameSite` or `cookieOptions` configuration was found in Agent Core source.
- No explicit shared cookie domain such as `.admate.ai.kr` was found in Agent Core or Compass auth client setup.

Readiness finding:

- A login session established on `sentinel.admate.ai.kr` should not be assumed to be readable on `compass.admate.ai.kr`.
- There is no audited cross-domain SSO handoff contract yet.
- A redirect alone is insufficient unless Compass can validate or receive a session after returning.

## External `next` and Open Redirect Risk

Current Agent Core login is safer than a permissive redirect because it rejects external and protocol-relative destinations.

However, adding Compass cross-domain return support would introduce a new security surface. Any future external return support should require:

- exact host allowlist, starting with `compass.admate.ai.kr`
- HTTPS-only URLs
- no username/password/port in the URL
- path allowlist or at least `/api` exclusion
- length limit
- no raw token or credential parameters in `next`
- central sanitizer shared by login, reset password, invite, and product handoff flows

Compass-local `next` should follow the same principles but should remain same-origin:

- allow relative paths only
- reject `//...`
- reject `/api` targets
- preserve only necessary query parameters
- default to `/chat-ollama` or `/` when invalid

## Safe Alternatives

### 1. Compass-Local Login Shell

Description:

- Add a Compass product login route such as `/login?next=/chat-ollama`.
- Preserve Compass-specific copy and product context.
- Use the existing Compass Supabase auth client and `useAuth()` session model.
- Link access requests to Agent Core/Sentinel or central request flow.

Pros:

- Lowest immediate risk.
- Same-origin `next` and same-origin session.
- Can preserve `/chat-ollama` context without cross-domain SSO assumptions.
- Does not require changes to RAGSearchService, `/api/chat-ollama`, database import, re-embedding, or crawler code.

Cons:

- Duplicates some login UI unless the shell reuses shared copy/components later.
- Does not solve true cross-product SSO by itself.

### 2. Agent Core Login With Same-Site `next` Only

Description:

- Keep Agent Core login as-is.
- Use `/login?next=/...` only for Sentinel/Agent Core pages.
- Do not use it as a Compass return handoff.

Pros:

- Keeps current open redirect protection.
- Works for Sentinel/Agent Core protected pages.
- No session sharing assumptions.

Cons:

- Does not solve Compass protected chat login.
- Sending Compass users there would likely keep them on Sentinel after login.

### 3. Central Auth Domain Handoff

Description:

- Introduce a true cross-product auth contract, potentially through a central auth domain or explicit SSO callback flow.
- Define product return allowlists, session exchange, PKCE/state, and audit logging.

Pros:

- Best long-term model for AdMate product family login.
- Can unify Compass, Sentinel, Lens, Foresight, and Agent Core.

Cons:

- Highest design and security cost.
- Requires explicit cookie/session/token strategy.
- Requires coordinated changes outside Compass.

## Minimum Change Candidate

The safest immediately implementable Compass-side change is:

1. Add a Compass-local product login shell.
2. Change `/chat-ollama` no-session behavior from redirecting to `/` to redirecting to `/login?next=/chat-ollama` or `/login?next=<sanitized current path and query>`.
3. Sanitize `next` as a relative Compass path only.
4. After successful Compass sign-in, route back to the sanitized `next`.
5. Keep access-request copy linked to `https://sentinel.admate.ai.kr/access-request` until a central auth contract exists.

This path preserves the product context and avoids pretending that Sentinel login automatically authenticates Compass.

## Risk Register

High:

- Direct Sentinel login handoff with external Compass `next` is not currently supported by Agent Core login sanitizer.
- Sentinel-origin login session should not be assumed to authenticate Compass-origin client code.

Medium:

- Compass and Agent Core Supabase project/session alignment is unverified because environment values were intentionally not read.
- Preserving a full protected URL may preserve user query text in `next`; keep `next` sanitized and avoid credential-like parameters.

Low to Medium:

- Agent Core open redirect risk is currently mitigated for login, but any future external allowlist must be centralized and tested.
- Current Compass root redirect is product-hostile rather than security-critical, but it blocks a coherent protected product entry.

## Recommendation

Proceed with a Compass-local login shell for the next implementation gate.

Do not implement direct `sentinel.admate.ai.kr/login?next=https://compass.admate.ai.kr/...` handoff until Agent Core has an explicit cross-product return contract and Compass has a verified way to receive or validate the resulting session.

Suggested next gates:

1. `Gate Compass-Auth-3 product login shell same-origin implementation`
   - Implement `/login` in Compass.
   - Use Compass-specific copy:
     - `AdMate Compass 로그인`
     - `정책 검색을 이용하려면 AdMate 계정으로 로그인하세요`
     - `접근 권한이 없다면 이용 신청`
   - Add a same-origin `next` sanitizer.
   - Redirect `/chat-ollama` no-session users to the Compass login shell.

2. `Gate AgentCore-Auth-Next-1 cross-product return contract design`
   - Decide whether Agent Core should support allowlisted external returns.
   - Define state/PKCE/session-sharing requirements.
   - Keep current same-site `next` behavior until the contract is complete.

3. `Gate Compass-Auth-4 authenticated visual QA`
   - Verify `/chat-ollama` authenticated entry, mobile layout, source panel stability, and access-request copy under an actual logged-in session.

## Verification Plan For This Audit

Required checks for this documentation artifact:

- `git diff --check -- docs/tasks/2026-05-08_compass_auth_2_cross_domain_session_readiness_audit_v1.md`
- `npm run check:secrets --if-present`
- confirm no staged files remain
