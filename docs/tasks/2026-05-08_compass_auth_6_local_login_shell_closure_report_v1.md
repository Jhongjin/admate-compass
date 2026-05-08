# Gate Compass-Auth-6 Local Login Shell Closure Report

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Production: `https://compass.admate.ai.kr`
Mode: closure report only

## Goal

Close the first AdMate Compass product login shell track as complete.

This report records the planning, readiness audit, minimal implementation, and production smoke for the Compass-local `/login` shell. No runtime code, RAG logic, database schema, import job, re-embedding job, crawler, Vercel setting, or production deployment setting was modified in this gate.

## Completed Gates

### Compass-Auth-1 Product Login Shell Integration Plan

Artifact:

- `docs/tasks/2026-05-08_compass_auth_1_product_login_shell_integration_plan_v1.md`

Commit:

- `a50dcef docs: plan Compass product login shell`

Outcome:

- Defined the product-context problem for no-session `/chat-ollama` users.
- Identified that the old behavior sent protected users back to `/` without preserving intent.
- Proposed product-specific Compass login copy and `next` preservation.
- Documented Agent Core canonical auth routes and the need to confirm cross-domain session behavior before direct handoff.

### Compass-Auth-2 Cross-Domain Session/Readiness Audit

Artifact:

- `docs/tasks/2026-05-08_compass_auth_2_cross_domain_session_readiness_audit_v1.md`

Commit:

- `ae44110 docs: audit Compass auth session handoff`

Outcome:

- Confirmed Compass checks its own Supabase browser session.
- Confirmed Agent Core/Sentinel login currently treats `next` as same-site relative only.
- Concluded that direct `sentinel.admate.ai.kr/login?next=https://compass.admate.ai.kr/...` handoff is not ready for Compass session continuity.
- Recommended Compass-local login shell plus same-origin sanitized `next`.

### Compass-Auth-3 Local Login Shell Implementation Plan

Artifact:

- `docs/tasks/2026-05-08_compass_auth_3_local_login_shell_implementation_plan_v1.md`

Commit:

- `d132f94 docs: plan Compass local login shell`

Outcome:

- Scoped the local `/login` route.
- Defined `/chat-ollama -> /login?next=/chat-ollama -> login success -> safe next` flow.
- Defined invalid `next` fallback to `/`.
- Listed candidate implementation files and sanitizer rules.
- Deferred `/reset-password` and `/account` integration to later gates.

### Compass-Auth-4 Local Login Shell Implementation

Implementation commit:

- `5c6cc30 feat: add Compass local login shell`

Changed files:

- `src/app/login/page.tsx`
- `src/lib/auth/safeNext.ts`
- `src/app/chat-ollama/page.tsx`

Outcome:

- Added Compass-local `/login` shell.
- Added required user-facing copy:
  - `AdMate Compass 로그인`
  - `정책 검색을 이용하려면 AdMate 계정으로 로그인하세요`
  - `접근 권한이 없다면 이용 신청`
- Changed `/chat-ollama` no-session redirect from `/` to `/login?next=/chat-ollama`.
- Added safe same-origin `next` sanitizer.
- Kept existing Compass Supabase auth/session logic.
- Did not modify `/api/chat-ollama`, `RAGSearchService`, database schema, import jobs, re-embedding jobs, or crawler code.

### Compass-Auth-5 Production Smoke

Artifact:

- `docs/tasks/2026-05-08_compass_auth_5_post_deploy_login_shell_smoke_v1.md`

Commit:

- `d9da72c docs: verify Compass login shell in production`

Outcome:

- Confirmed production `/login` returned HTTP `200`.
- Confirmed visible production copy:
  - `AdMate Compass 로그인`
  - `정책 검색을 이용하려면 AdMate 계정으로 로그인하세요`
  - `접근 권한이 없다면 이용 신청`
- Confirmed no-session `/chat-ollama` navigates to `/login?next=/chat-ollama`.
- Confirmed invalid `next` values do not trigger pre-auth external redirect.
- Confirmed `/api/chat-ollama` production contract remained intact:
  - `schema=compass`
  - `sources` array present
  - `sourcesCount=3`

## Final Implemented State

Current Compass auth entry behavior:

```text
/chat-ollama without session
-> /login?next=/chat-ollama
```

Current login shell:

```text
/login
```

Implemented user-facing behavior:

- Compass-local route, not Sentinel-hosted login.
- Product-specific login copy.
- External access request link only; no access request form submit inside Compass.
- Login success returns to sanitized same-origin `next`.
- Invalid or unsafe `next` falls back to `/`.

Implemented sanitizer behavior:

- Allows relative same-origin Compass paths only.
- Allows `/chat-ollama`.
- Allows `/history`.
- Allows `/`.
- Blocks external URLs.
- Blocks protocol-relative `//...`.
- Blocks `/api` and `/api/...`.
- Blocks `javascript:` style input.
- Drops sensitive query keys such as token/password-style parameters.

## Confirmed Non-Changes

The following areas were intentionally not modified:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- DB schema files
- migration/import SQL execution
- re-embedding jobs
- crawler code
- Vercel project settings
- production environment variables
- manual deploy trigger

Production RAG/API contract remains intact:

- `/api/chat-ollama` continues to return `schema=compass`.
- Source evidence remains present.
- Production smoke recorded `sourcesCount=3`.
- RAG/search behavior was not changed by the login shell work.

## Verification Summary

Completed during the track:

- `npm run type-check`: pass
- `npm run build`: pass
- `npm run verify:harness`: pass
- `npm run check:secrets --if-present`: pass
- Sanitizer 9-case static/dynamic check: pass
- Production `/login` smoke: pass
- Production `/chat-ollama` no-session redirect smoke: pass
- Production `/api/chat-ollama` contract smoke: pass

Known recurring harness note:

- `verify:harness` continues to report the existing admin/debug surface review warning set of 25 routes.
- This is not part of the Compass login shell scope and remains a separate backlog item.

## Remaining Backlog

Recommended Compass follow-up:

- Authenticated `/chat-ollama` visual QA using an approved test account.
- Mobile source panel QA under an authenticated session.
- Account/profile link integration decision:
  - keep Compass-local account surfaces minimal, or
  - link to Agent Core account once cross-product account ownership is confirmed.
- Product-level access request copy/link refinement:
  - confirm whether Sentinel or Home is the canonical access request destination.
- Product entitlement audit:
  - separate plain Supabase authentication from Compass product authorization.

Platform backlog:

- Admin/debug warning set of 25 routes remains a separate production hardening backlog.
- Central cross-domain auth handoff design remains open for later Agent Core work.
- Lens and Foresight product login shell rollout should reuse the same lessons:
  - product-local shell first
  - same-origin `next`
  - external handoff only after shared session contract is verified

## Closure Decision

Compass product login shell first-pass work is complete.

The production user path no longer drops no-session `/chat-ollama` users back to public root. It now preserves Compass product context through the local login shell and keeps the RAG/API contract untouched.
