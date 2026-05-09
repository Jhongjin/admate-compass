# Compass Admin/Debug Guard Strategy Plan v1

Date: 2026-05-09

## Status

Gate Compass-Admin-Debug-2 is documentation-only. It converts the admin/debug surface inventory into a guard strategy before any code changes.

## Goal

Reduce Compass admin/debug production exposure without changing RAG behavior, `/api/chat-ollama`, DB/schema, imports, reembedding, crawler, or production data.

The strategy is to classify each route into one of five buckets:

- public allowlist
- admin-session guarded
- internal-key guarded
- production-disabled
- deprecated/remove candidate

Implementation should happen only after this classification is accepted by follow-up gates.

## Guard Principles

### 1. Fail closed

Admin, debug, repair, test, migration, and provider diagnostic routes should not return useful data or perform side effects without an approved guard.

### 2. Preserve public product routes

Normal public/product routes must not be broken by the admin/debug cleanup. In particular, `latest-update` should be handled as a public allowlist candidate rather than hidden among debug warnings.

### 3. Guard before work

Request auth/permission checks should run before:

- service-role client creation
- provider/API calls
- DB queries
- file parsing
- import/reindex/reembedding logic
- email/log alert processing

### 4. Redact error output

No debug route should return raw stack traces, provider payloads, service-role error objects, env values, credential names with values, or schema internals to unauthenticated callers.

### 5. Separate high-risk operations

Routes that can mutate documents, chunks, embeddings, alerts, or schema state should require a stronger guard than read-only dashboard/status routes.

## Route Classification

### Public Allowlist Candidate

- `src/app/api/latest-update/route.ts`

Recommended action:

- keep public if still required by the root page
- update `scripts/check-admin-debug-surface.mjs` to classify it as approved public instead of a generic warning
- ensure response contains no admin/debug/internal data

### Admin-Session Guard Candidates

These routes belong behind an authenticated admin/session contract:

- `src/app/api/admin/dashboard/route.ts`
- `src/app/api/admin/status/route.ts`
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/users/check-admin/route.ts`
- `src/app/api/admin/users/permissions/route.ts`
- `src/app/api/admin/document-actions/route.ts`
- `src/app/api/admin/url-templates/route.ts`
- `src/app/api/admin/monitoring/route.ts`
- `src/app/api/admin/logs/alerts/route.ts`
- `src/app/api/admin/logs/create/route.ts`
- `src/app/api/admin/upload/route.ts`

Recommended no-session shape:

```json
{ "error": "Authentication required." }
```

Recommended insufficient permission shape:

```json
{ "error": "Admin access required." }
```

### Internal-Key Guard Candidates

These routes are better treated as operational jobs or diagnostics, not browser admin UI:

- `src/app/api/admin/logs/process-alerts/route.ts`
- `src/app/api/admin/direct-process/route.ts`
- `src/app/api/admin/simple-index/route.ts`
- `src/app/api/admin/sync-status/route.ts`
- `src/app/api/admin/clean-titles/route.ts`

Recommended action:

- require a server-only internal key
- reject all missing/invalid credentials before side effects
- remove unauthenticated test `GET` execution paths
- return sanitized error JSON only

### Production-Disabled Candidates

These routes are high-risk in production and should be disabled unless an explicit future operational contract exists:

- `src/app/api/debug-env/route.ts`
- `src/app/api/debug-database-state/route.ts`
- `src/app/api/debug-embedding-data/route.ts`
- `src/app/api/debug-rag/route.ts`
- `src/app/api/admin/debug-db/route.ts`
- `src/app/api/admin/check-db/route.ts`
- `src/app/api/admin/check-schema/route.ts`
- `src/app/api/admin/test-filter/route.ts`
- `src/app/api/check-data-integrity/route.ts`
- `src/app/api/check-embedding-dimension/route.ts`
- `src/app/api/check-real-embedding-dimension/route.ts`
- `src/app/api/check-table-constraints/route.ts`
- `src/app/api/ollama/local-test/route.ts`
- `src/app/api/test-huggingface/route.ts`
- `src/app/api/test-integration/route.ts`
- `src/app/api/test-proxy/route.ts`
- `src/app/api/test-rag-search/route.ts`
- `src/app/api/test-rpc-direct/route.ts`
- `src/app/api/test-rpc-function/route.ts`

Recommended production-disabled shape:

```json
{ "error": "Not found." }
```

or:

```json
{ "error": "Route disabled." }
```

Pick one in the implementation gate and use it consistently.

### Repair / Mutation Guard Candidates

These routes can alter RAG/import/embedding state and should not be implemented as general admin-session only routes without a second explicit operational decision:

- `src/app/api/fix-embedding-dimension/route.ts`
- `src/app/api/fix-orphaned-chunks/route.ts`
- `src/app/api/force-regenerate-embeddings/route.ts`
- `src/app/api/regenerate-embeddings/route.ts`
- `src/app/api/admin/migrate/route.ts`

Recommended action:

- keep disabled in production for now
- require a separate approved maintenance gate before any execution path is opened
- do not run reembedding, crawler, migration, or cleanup during guard implementation

## Page Surface Strategy

Admin pages should not rely on layout components for access control.

Recommended later gate:

- add central admin page guard or route-level guard
- verify `/admin`, `/admin/docs`, `/admin/logs`, `/admin/monitoring`, `/admin/stats`, `/admin/status`, `/admin/users` no-session behavior
- do not alter public `/`, `/login`, `/chat-ollama`, or product docs/search entry points

## Checker Strategy

Update `scripts/check-admin-debug-surface.mjs` in a test-only gate before or alongside implementation.

Desired checker output:

- approved public allowlist count
- admin-session guard required count
- internal-key guard required count
- production-disabled required count
- repair/mutation route count
- fail if a Tier 1 high-risk route is neither guarded nor disabled
- keep warnings for routes intentionally deferred

This avoids hiding high-risk routes behind a single `25 review warnings` line.

## Rollout Order

1. Checker classification update, no product behavior change.
2. Disable or fail-close production debug/test routes.
3. Guard admin APIs with admin session or internal key.
4. Guard admin pages.
5. Production-safe negative smoke.
6. Optional authenticated admin QA only after explicit login/session approval.

## Boundaries

This plan does not authorize:

- DB/schema changes
- RAG reembedding
- crawler execution
- benchmark/import/upload execution
- production API mutation
- secret/env/token/cookie output
- `/api/chat-ollama` behavior changes
- `RAGSearchService` changes

## Verification

Use:

```text
npm run check:admin-debug-surface
npm run verify:harness
npm run type-check
npm run build
git diff --check -- docs/tasks/2026-05-09_compass_admin_debug_2_guard_strategy_plan_v1.md
```

Expected result:

- docs-only diff
- existing 25 review warnings unchanged
- no code or RAG behavior changes
