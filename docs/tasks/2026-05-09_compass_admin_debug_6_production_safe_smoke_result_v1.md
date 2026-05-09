# Compass Admin/Debug Production-Safe Smoke Result v1

- Gate: Compass-Admin-Debug-6
- Date: 2026-05-09
- Mode: production-safe negative smoke
- Base URL: `https://compass.admate.ai.kr`
- Commit context: after `90c55b5f4 fix: fail closed Compass admin debug routes`

## Summary

Production-safe negative smoke passed for the newly production-disabled Compass admin/debug/fix/test route set.

The smoke used unauthenticated requests only:

- no browser login
- no cookie jar
- no `Authorization` header
- no product/admin credential
- no request body except `{}` for `POST`

No DB mutation, repair action, migration, reembedding, crawler, chat/RAG behavior change, product data cleanup, authenticated admin access, or credential use was performed.

## Result

Overall verdict: `PASS`

Observed response groups:

- guarded route-methods: 26 checks returned the expected disabled-route contract
- framework method behavior: 43 checks returned method-level framework responses (`405` for unsupported methods or `204` for framework OPTIONS handling)
- exposure scan: no secret, token, cookie, credential, raw env, raw DB, raw provider, document, chunk, embedding, source, generated answer, stack, or repair/migration output observed
- `Set-Cookie`: absent for all checks

Expected disabled-route contract observed:

```json
{
  "success": false,
  "error": "Not found",
  "code": "ADMIN_DEBUG_ROUTE_DISABLED"
}
```

For the disabled-route contract responses:

- HTTP status: `404`
- `cache-control`: includes `no-store`
- JSON keys: `success,error,code`
- `Set-Cookie`: absent

## Routes Checked

The smoke covered the production-disabled route set from the guard scope:

- `/api/admin/check-db`
- `/api/admin/check-schema`
- `/api/admin/debug-db`
- `/api/admin/migrate`
- `/api/admin/test-filter`
- `/api/check-data-integrity`
- `/api/check-embedding-dimension`
- `/api/check-real-embedding-dimension`
- `/api/check-table-constraints`
- `/api/debug-database-state`
- `/api/debug-embedding-data`
- `/api/debug-env`
- `/api/debug-rag`
- `/api/fix-embedding-dimension`
- `/api/fix-orphaned-chunks`
- `/api/force-regenerate-embeddings`
- `/api/ollama/local-test`
- `/api/test-huggingface`
- `/api/test-integration`
- `/api/test-proxy`
- `/api/test-rag-search`
- `/api/test-rpc-direct`
- `/api/test-rpc-function`

Methods checked per route:

- `GET`
- `POST`
- `OPTIONS`

## Framework Method Behavior

Some methods are not implemented by their route module and therefore returned framework-level responses before route logic:

- unsupported methods returned `405`
- framework OPTIONS handling returned `204`

These responses did not include cookies or sensitive/internal payloads. They were recorded as framework method behavior, not as a disabled-route contract failure.

## Separate Item

`/api/admin/users/check-admin` remains outside this production-disabled smoke. It is still tracked separately as the remaining admin-session contract review warning from `npm run check:admin-debug-surface`.

## Verification

Local verification after the smoke:

- `npm run check:admin-debug-surface`: pass, with `23 production disabled guards`, `1 public allowlist`, and the expected `admin/users/check-admin` review warning
- `npm run verify:harness`: pass
- `git diff --check -- docs/tasks/2026-05-09_compass_admin_debug_6_production_safe_smoke_result_v1.md`: pass
- staged files: none before this result was written

## No-Touch Confirmation

This gate did not change:

- `/api/chat-ollama`
- `RAGSearchService`
- RAG fixtures
- DB/schema/import/reembedding/crawler code
- production data
- credentials or environment variables
