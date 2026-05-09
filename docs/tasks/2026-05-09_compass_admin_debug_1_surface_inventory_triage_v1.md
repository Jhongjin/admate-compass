# Compass Admin/Debug Surface Inventory Triage v1

Date: 2026-05-09

## Status

Gate Compass-Admin-Debug-1 is read-only documentation. It inventories the admin/debug/internal surface that remains after the production root and metadata cleanup.

## Background

`Gate Compass-Production-6` closed the public root parity issue. The production root no longer bootstraps the previous admin/status calls, but `verify:harness` still reports 25 admin/debug surface review warnings through `scripts/check-admin-debug-surface.mjs`.

This gate does not remediate those routes. It records the current surface and separates follow-up work into safer implementation queues.

## Current Guard Shape

No central `middleware.ts` or `src/middleware.ts` was found.

Admin page protection is inconsistent:

- `/admin` and `/admin/stats` use `useAuth()` user presence checks.
- Several admin pages are routed through `AdminLayout`, but `AdminLayout` is a shell/navigation component and not an access guard.
- Admin pages call `/api/admin/*` endpoints directly from the browser.

Admin API protection is inconsistent:

- Many `/api/admin/*` routes use server-side/service-role capabilities without an obvious request auth guard.
- `/api/admin/logs/process-alerts` protects `POST` with a bearer secret, but its test `GET` path can process alerts without that check.
- Several debug/check/fix/test routes are outside `/api/admin/*` and are still part of the production route tree.

## Harness Warning Inventory

`npm run check:admin-debug-surface` currently passes with 25 review warnings:

- `src/app/api/admin/check-db/route.ts`
- `src/app/api/admin/check-schema/route.ts`
- `src/app/api/admin/debug-db/route.ts`
- `src/app/api/admin/migrate/route.ts`
- `src/app/api/admin/test-filter/route.ts`
- `src/app/api/admin/users/check-admin/route.ts`
- `src/app/api/check-data-integrity/route.ts`
- `src/app/api/check-embedding-dimension/route.ts`
- `src/app/api/check-real-embedding-dimension/route.ts`
- `src/app/api/check-table-constraints/route.ts`
- `src/app/api/debug-database-state/route.ts`
- `src/app/api/debug-embedding-data/route.ts`
- `src/app/api/debug-env/route.ts`
- `src/app/api/debug-rag/route.ts`
- `src/app/api/fix-embedding-dimension/route.ts`
- `src/app/api/fix-orphaned-chunks/route.ts`
- `src/app/api/force-regenerate-embeddings/route.ts`
- `src/app/api/latest-update/route.ts`
- `src/app/api/ollama/local-test/route.ts`
- `src/app/api/test-huggingface/route.ts`
- `src/app/api/test-integration/route.ts`
- `src/app/api/test-proxy/route.ts`
- `src/app/api/test-rag-search/route.ts`
- `src/app/api/test-rpc-direct/route.ts`
- `src/app/api/test-rpc-function/route.ts`

`latest-update` is included by the broad `check-` pattern and should be reviewed separately from true debug/mutation routes.

## Risk Tiers

### Tier 0: keep public / low risk candidate

- `src/app/api/latest-update/route.ts`

Reason: expected public root update endpoint observed in prior production smoke. It still needs explicit allowlist treatment so broad debug checks do not obscure the real backlog.

### Tier 1: disable or guard first

- `src/app/api/debug-env/route.ts`
- `src/app/api/fix-orphaned-chunks/route.ts`
- `src/app/api/fix-embedding-dimension/route.ts`
- `src/app/api/force-regenerate-embeddings/route.ts`
- `src/app/api/admin/migrate/route.ts`
- `src/app/api/admin/upload/route.ts`
- `src/app/api/admin/logs/process-alerts/route.ts`

Reasons:

- exposes environment metadata shape, even when masked
- can mutate database rows or indexing state
- can process email/log alert side effects
- can expose error details or stack traces
- may touch RAG/import/reembedding behavior

### Tier 2: admin-only / internal diagnostic

- `src/app/api/admin/check-db/route.ts`
- `src/app/api/admin/check-schema/route.ts`
- `src/app/api/admin/debug-db/route.ts`
- `src/app/api/admin/test-filter/route.ts`
- `src/app/api/admin/users/check-admin/route.ts`
- `src/app/api/check-data-integrity/route.ts`
- `src/app/api/check-embedding-dimension/route.ts`
- `src/app/api/check-real-embedding-dimension/route.ts`
- `src/app/api/check-table-constraints/route.ts`
- `src/app/api/debug-database-state/route.ts`
- `src/app/api/debug-embedding-data/route.ts`
- `src/app/api/debug-rag/route.ts`
- `src/app/api/ollama/local-test/route.ts`
- `src/app/api/test-huggingface/route.ts`
- `src/app/api/test-integration/route.ts`
- `src/app/api/test-proxy/route.ts`
- `src/app/api/test-rag-search/route.ts`
- `src/app/api/test-rpc-direct/route.ts`
- `src/app/api/test-rpc-function/route.ts`

Reasons:

- diagnostic/test naming implies non-public use
- may disclose internal state, provider status, schema shape, or RAG retrieval details
- should be behind a clear admin/session/internal key contract or removed from production route tree

## Recommended Follow-Up Queues

### Gate Compass-Admin-Debug-2 Guard Strategy Plan

Docs-only plan to choose route categories:

- public allowlist
- admin session guarded
- internal-key guarded
- disabled in production
- deleted/deprecated

This gate should also define response shape for no-session/no-permission, redaction rules, and checker updates.

### Gate Compass-Admin-Debug-3 Checker Hardening

Test-only update to `scripts/check-admin-debug-surface.mjs`:

- separate warnings by tier
- explicitly allow `latest-update` if it remains public
- fail on high-risk unguarded mutation/debug routes only after strategy is approved

### Gate Compass-Admin-Debug-4 Minimal Guard Implementation

Implementation gate for approved routes only. It should not run imports, reembedding, crawler, DB cleanup, or provider calls.

## Boundaries

This gate did not:

- modify code
- call production APIs
- run RAG reembedding or crawler
- mutate DB/Auth data
- upload/import documents
- read or output secret/env values
- change `/api/chat-ollama`
- change `RAGSearchService`

## Verification

Commands:

```text
npm run check:admin-debug-surface
npm run verify:harness
npm run type-check
npm run build
git diff --check -- docs/tasks/2026-05-09_compass_admin_debug_1_surface_inventory_triage_v1.md
```

Expected result:

- `check:admin-debug-surface` passes with the known 25 review warnings
- `verify:harness` passes while preserving the same warning count
- docs-only diff check passes
