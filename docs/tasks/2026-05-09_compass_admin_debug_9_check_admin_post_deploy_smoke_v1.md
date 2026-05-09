# Compass Admin Debug 9 Check Admin Post-Deploy Smoke v1

Date: 2026-05-09
Status: pass
Scope: production-safe no-session smoke for `/api/admin/users/check-admin`

## Verdict

The production deployment now serves the fail-closed admin-session guard for
`/api/admin/users/check-admin`.

## Production Target

- Base URL: `https://compass.admate.ai.kr`
- Endpoint: `/api/admin/users/check-admin`
- Method: `POST`
- Request body: `{}`
- Cookies/credentials: none

## Deployment Poll

The first three checks still observed the previous deployment behavior:

```text
400 {"success":false,"error":"이메일이 필요합니다."}
```

The fourth check observed the new deployment behavior:

```text
401 {"success":false,"error":"Authentication required"}
```

Final observed headers:

- `Cache-Control`: `no-store`
- `Set-Cookie`: not present

## Sensitive Output Review

No response exposed secret values, env values, service-role values, tokens,
cookies, session values, provider payloads, raw database rows, or admin user
records.

## No-Touch Confirmation

Not performed:

- login/session reuse
- admin credential use
- real email probing
- DB mutation
- Auth mutation
- `admin_users` write
- user activation/deactivation
- `/api/chat-ollama` changes
- `RAGSearchService` changes
- import/crawler/reembedding changes

## Result

`/api/admin/users/check-admin` is now closed in production until a deliberate
authenticated admin-session contract is implemented.
