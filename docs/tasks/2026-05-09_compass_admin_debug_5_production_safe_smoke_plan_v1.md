# Gate Compass-Admin-Debug-5

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Mode: production-safe negative smoke plan
Commit context: after `90c55b5f4 fix: fail closed Compass admin debug routes`

## 1. Goal

Verify that the admin/debug/fix/test routes newly production-disabled by `90c55b5f4` fail closed in production without exposing internal data or running any operational behavior.

This is a negative smoke only. It must prove that unauthenticated production callers receive the disabled-route response before route logic can create service-role clients, query data, run repairs, call providers, or touch RAG behavior.

## 2. Allowed Requests

Only these request properties are allowed:

- unauthenticated requests
- no `Cookie` header
- no bearer token or custom credential header
- `GET`, `POST`, and `OPTIONS` only
- one request per method per listed route unless a retry is needed for a network failure before the app receives the request
- empty request body, or `{}` for `POST` only when the client requires a body

Do not sign in. Do not reuse a browser session. Do not send production admin cookies, Supabase cookies, bearer tokens, API keys, internal keys, CSRF values, or any credential-like header.

## 3. Target Routes

Smoke only the production-disabled routes from the `90c55b5f4` guard scope:

| Route | Methods to check |
| --- | --- |
| `/api/admin/check-db` | `GET`, `POST`, `OPTIONS` |
| `/api/admin/check-schema` | `GET`, `POST`, `OPTIONS` |
| `/api/admin/debug-db` | `GET`, `POST`, `OPTIONS` |
| `/api/admin/migrate` | `GET`, `POST`, `OPTIONS` |
| `/api/admin/test-filter` | `GET`, `POST`, `OPTIONS` |
| `/api/check-data-integrity` | `GET`, `POST`, `OPTIONS` |
| `/api/check-embedding-dimension` | `GET`, `POST`, `OPTIONS` |
| `/api/check-real-embedding-dimension` | `GET`, `POST`, `OPTIONS` |
| `/api/check-table-constraints` | `GET`, `POST`, `OPTIONS` |
| `/api/debug-database-state` | `GET`, `POST`, `OPTIONS` |
| `/api/debug-embedding-data` | `GET`, `POST`, `OPTIONS` |
| `/api/debug-env` | `GET`, `POST`, `OPTIONS` |
| `/api/debug-rag` | `GET`, `POST`, `OPTIONS` |
| `/api/fix-embedding-dimension` | `GET`, `POST`, `OPTIONS` |
| `/api/fix-orphaned-chunks` | `GET`, `POST`, `OPTIONS` |
| `/api/force-regenerate-embeddings` | `GET`, `POST`, `OPTIONS` |
| `/api/ollama/local-test` | `GET`, `POST`, `OPTIONS` |
| `/api/test-huggingface` | `GET`, `POST`, `OPTIONS` |
| `/api/test-integration` | `GET`, `POST`, `OPTIONS` |
| `/api/test-proxy` | `GET`, `POST`, `OPTIONS` |
| `/api/test-rag-search` | `GET`, `POST`, `OPTIONS` |
| `/api/test-rpc-direct` | `GET`, `POST`, `OPTIONS` |
| `/api/test-rpc-function` | `GET`, `POST`, `OPTIONS` |

`/api/admin/users/check-admin` remains outside this smoke. Treat it as a separate review warning and admin-session contract item, not as part of the production-disabled route set.

## 4. Expected Response Contract

For every allowed request, the expected production-disabled response is:

- HTTP status: `404`
- `cache-control` includes `no-store`
- JSON response body:

```json
{
  "success": false,
  "error": "Not found",
  "code": "ADMIN_DEBUG_ROUTE_DISABLED"
}
```

If a method is not implemented by Next.js before it reaches the route module, record that separately as method-framework behavior. The gate still passes only if the implemented guarded methods return the disabled-route contract and no method exposes useful admin/debug data.

## 5. Exposure Checks

For each response, inspect only status, headers, and sanitized body shape.

Fail the smoke if any response includes:

- secret, token, password, API key, service-role key, private key, bearer value, session value, or cookie value
- raw environment values or masked environment inventories
- database rows, schema/table/constraint internals, chunk contents, document contents, embeddings, provider payloads, stack traces, or raw error objects
- RAG retrieval results, source snippets, generated answers, model output, crawler/import status, repair counts, migration output, or cleanup results
- `set-cookie` headers
- cacheable success or redirect behavior for the disabled route

## 6. Explicitly Forbidden

This gate must not perform or authorize:

- DB mutations
- schema migrations
- repair actions
- orphan/chunk cleanup
- embedding dimension fixes
- reembedding or regeneration
- crawler/import/upload execution
- chat, RAG, retrieval, answer-generation, or source-panel behavior changes
- product data cleanup or document edits
- credential creation, credential lookup, credential use, or credential output
- authenticated admin access
- authenticated browser UI QA
- changes to `/api/chat-ollama`, `RAGSearchService`, product routes, public root behavior, or data fixtures

## 7. Suggested Smoke Shape

Use a script or one-off client that constructs a fresh request for each route and method with no cookie jar:

```text
BASE_URL=https://compass.admate.ai.kr
for each route in target_routes:
  for method in GET, POST, OPTIONS:
    request BASE_URL + route with no Cookie and no Authorization
    record status, cache-control, content-type, set-cookie presence, and parsed JSON keys
    do not print full raw response if it contains unexpected data
```

Recommended result table columns:

```text
route | method | status | cache-control no-store | json shape | set-cookie absent | exposure scan | verdict
```

## 8. Stop Conditions

Stop immediately and do not continue probing if:

- any route returns `2xx` with admin/debug data
- any route starts a mutation, repair, migration, reembedding, crawler, provider diagnostic, or RAG flow
- any response exposes credential-like, cookie-like, token-like, raw DB, raw env, or raw stack data
- authenticated state is accidentally attached to the client

Record the first failing route/method with sanitized details only.

## 9. Local Validation Before Hand-Off

Run these local checks from `D:\Projects\AdMate\admate-compass`:

```text
git diff --check
npm run check:admin-debug-surface
npm run verify:harness
git diff --cached --name-only
```

`npm run verify:harness` is reasonable if dependencies are available and runtime remains local. It does not authorize production API calls, database mutations, credentials, imports, reembedding, crawler, or authenticated admin access.

Expected validation:

- `git diff --check` passes
- `npm run check:admin-debug-surface` passes and reports the guarded production-disabled routes
- `npm run verify:harness` passes, or any inability to run it is documented
- `git diff --cached --name-only` prints no staged files

## 10. Completion Criteria

The gate can close only when:

- every listed production-disabled route returns the expected unauthenticated negative response for implemented guarded methods
- no response exposes secret, token, cookie, credential, raw DB, raw env, raw error, raw provider, document, chunk, embedding, source, or generated-answer data
- no operational side effects are invoked
- `/api/admin/users/check-admin` remains tracked separately as a review warning/admin-session contract
- changed files are documentation-only
- no files are staged, committed, or pushed
