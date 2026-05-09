# Compass Admin Debug 8 Check Admin Guard Result v1

Date: 2026-05-09
Status: pass
Scope: production fail-closed guard for `/api/admin/users/check-admin`

## Verdict

The remaining admin/debug surface review warning is closed.

`/api/admin/users/check-admin` now fails closed in production before request body
parsing, service-role Supabase client creation, or admin lookup. Local and
non-production behavior remains available for future admin-session contract work.

## Why This Was Needed

The production-safe negative check showed that a no-session empty request returned
`400` with a missing-email response and cache headers that were not the intended
admin-session guard contract.

The endpoint should not accept caller-supplied email as proof of admin status in
production before an authenticated admin-session contract exists.

## Changes

Files changed:

- `src/lib/adminDebugGuard.ts`
- `src/app/api/admin/users/check-admin/route.ts`
- `scripts/check-admin-debug-surface.mjs`

Implementation summary:

- added `guardProductionAdminSessionRoute()`
- applied the guard as the first statement in `POST /api/admin/users/check-admin`
- moved service-role Supabase client creation behind the production guard
- updated `check-admin-debug-surface` to classify this endpoint as
  `admin-session guarded`

Production guard response:

```json
{
  "success": false,
  "error": "Authentication required"
}
```

Expected status: `401`

Expected cache header: `no-store`

## Verification

Local checks:

```text
npm run check:admin-debug-surface
```

Observed:

```text
ok (0 review warnings, 23 production disabled guards, 1 admin-session guards, 1 public allowlist)
```

Additional checks were run before commit:

```text
git diff --check
npm run type-check
npm run build
npm run verify:harness
```

## No-Touch Confirmation

Not performed:

- DB mutation
- Auth mutation
- `admin_users` write
- user activation/deactivation
- email enumeration with real addresses
- login/session reuse
- credential output
- `/api/chat-ollama` changes
- `RAGSearchService` changes
- import/crawler/reembedding changes

## Remaining Work

Authenticated admin UX can be reopened later only after a deliberate admin-session
contract exists. Until then, production stays fail-closed.
