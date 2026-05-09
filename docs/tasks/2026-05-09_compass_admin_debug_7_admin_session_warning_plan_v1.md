# Gate Compass-Admin-Debug-7

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: remaining admin-session warning plan

## 1. Scope

This plan covers only the remaining `npm run check:admin-debug-surface` review warning:

- `/api/admin/users/check-admin`
- source: `src/app/api/admin/users/check-admin/route.ts`

It does not reopen the production-disabled smoke route set from Compass-Admin-Debug-5/6.

## 2. Why It Was Excluded From Production-Disabled Smoke

`/api/admin/users/check-admin` was intentionally excluded from the production-disabled smoke because it is not a debug, repair, migration, fixture, provider-test, or RAG diagnostic route that should simply disappear in production.

The route currently behaves like an admin identity/permission diagnostic: it accepts an email and checks the `admin_users` table. That makes it an admin-session contract item, not part of the fail-closed production-disabled route set that returns `ADMIN_DEBUG_ROUTE_DISABLED`.

Including it in the production-disabled smoke would have mixed two different decisions:

- production-disabled debug/test/repair routes should return the disabled-route contract before any work
- admin identity routes need a deliberate session and authorization contract before they can be safely exposed

Compass-Admin-Debug-6 therefore recorded it as the one remaining admin-session review warning instead of probing it alongside disabled debug routes.

## 3. Candidate Admin-Session Guard Contract

Future implementation should guard `/api/admin/users/check-admin` before any DB client creation, request body parsing, or admin lookup.

Candidate request contract:

- allow only the method or methods required by the real admin UI
- require a valid authenticated user session from the approved app auth mechanism
- require the authenticated session user to already have admin permission
- reject caller-supplied identity escalation, including using a submitted `email` as proof of admin status
- do not use service-role access until after session and admin authorization pass
- return sanitized JSON only
- set `Cache-Control: no-store` on all responses
- do not set cookies from this endpoint

Candidate no-session response:

```json
{
  "success": false,
  "error": "Authentication required"
}
```

Candidate insufficient-permission response:

```json
{
  "success": false,
  "error": "Admin access required"
}
```

Candidate authorized response should be minimal and should not expose database rows, internal user records, role lists, or raw Supabase errors. If the UI only needs a boolean, return only a boolean and a success flag.

## 4. Safe Negative Checks Only

Any production validation for this route must be limited to unauthenticated negative checks.

Allowed production checks:

- no `Cookie` header
- no `Authorization` header
- no bearer token, API key, CSRF token, internal key, or custom credential header
- no browser session reuse
- no sign-in flow
- one request per reviewed method unless a network failure happens before the app receives the request
- empty body, or `{}` only if a `POST` client requires a JSON body
- inspect only status, cache headers, `set-cookie` presence, content type, and sanitized JSON shape

The negative check passes only if the route fails closed without exposing admin state, credential material, raw errors, DB internals, or session data.

This plan does not authorize authenticated production probing. Authenticated admin QA requires a separate approved gate that names the account/session source, expected permissions, and data exposure limits.

## 5. Explicitly Forbidden

This gate must not perform or authorize:

- DB mutations
- schema migrations
- writes to `admin_users` or any auth/admin table
- creation, deletion, activation, deactivation, or permission changes for users
- credential lookup, credential creation, credential use, or credential output
- production admin cookie use
- Supabase service-role key use from a client or script
- bearer token, API key, CSRF token, internal key, or browser session reuse
- password reset, magic link, invite, signup, or login flows
- email enumeration tests against real production addresses
- probing with known employee, admin, customer, or synthetic credential addresses
- changes to `/api/chat-ollama`, `RAGSearchService`, imports, crawler, reembedding, fixtures, or product data

## 6. Implementation Notes For A Later Gate

A later code gate should decide whether the endpoint is still needed. Preferred outcomes, in order:

1. Remove the endpoint if no current admin UI depends on it.
2. Replace caller-supplied email checks with a session-derived admin check.
3. Share a central admin API guard with the other admin-session routes.
4. Keep service-role DB access server-only and after the guard.
5. Update `scripts/check-admin-debug-surface.mjs` so this route is counted as admin-session guarded instead of a review warning.

Do not implement those changes in this documentation gate.

## 7. Completion Criteria

This gate is complete when:

- the remaining warning is documented as `/api/admin/users/check-admin` only
- the reason for excluding it from production-disabled smoke is explicit
- the candidate admin-session guard contract is documented
- production validation is limited to safe unauthenticated negative checks
- forbidden DB/auth mutations and credential use are explicit
- changed files are documentation-only
- no files are staged, committed, or pushed

## 8. Local Validation

Run from `D:\Projects\AdMate\admate-compass`:

```text
git diff --check
npm run check:admin-debug-surface
git diff --cached --name-only
```

Expected validation:

- `git diff --check` passes
- `npm run check:admin-debug-surface` passes with the expected single `admin/users/check-admin` review warning
- `git diff --cached --name-only` prints no staged files
