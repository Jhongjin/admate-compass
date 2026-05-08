# Gate Compass-Production-1

Date: 2026-05-08
Repo: `D:\Projects\AdMate\admate-compass`
Mode: Read-only audit
Scope: production root deployment parity and public admin surface audit

## 1. Executive Summary

Production root parity is currently blocked by a source-of-truth mismatch, not by an obvious Vercel repo mis-link.

`https://compass.admate.ai.kr/` is serving an old Meta FAQ style root because the desired AdMate Compass landing in the local working tree is not part of the deployed Git `HEAD`. The latest production deployment is linked to the correct Vercel project, correct GitHub repo, correct branch, and the latest pushed commit, but that commit still contains the old root page implementation.

The repeated public `500` calls to `/api/admin/dashboard` and `/api/admin/status` are consistent with the deployed root page in `HEAD`, which still imports dashboard/status hooks intended for operational/admin surfaces. This is a production surface issue because a public landing should not eagerly call admin/debug-style endpoints on first load.

## 2. Audit Questions and Answers

### Q1. Is local Git aligned with `origin/main`?

Yes.

- Current branch: `main`
- Local `HEAD`: `30db8d6398a1c11f8d64b8ddb04d592ccb75034d`
- `origin/main`: `30db8d6398a1c11f8d64b8ddb04d592ccb75034d`

Conclusion: local Git history and remote `main` are aligned at the pushed commit.

### Q2. Is the Vercel project linked to the correct repo and branch?

Yes, based on local Vercel metadata and read-only Vercel CLI inspection.

- Local `.vercel/project.json`:
  - `projectName`: `admate-compass`
- Vercel deployment inspect logs:
  - project: `admate-compass`
  - branch: `main`
  - commit: `30db8d6`
  - repo clone line: `Cloning github.com/Jhongjin/admate-compass (Branch: main, Commit: 30db8d6)`

Conclusion: the current production deployment is linked to the canonical Compass repo and `main` branch.

### Q3. Does the latest production deployment commit match local `HEAD`?

Yes.

- Local `HEAD`: `30db8d6398a1c11f8d64b8ddb04d592ccb75034d`
- Vercel deployment build log commit: `30db8d6`

Conclusion: deployment parity at the Git commit level is correct.

### Q4. Why does production still look like the old Meta FAQ root?

Because the new Compass landing exists only in the local dirty working tree, not in the deployed commit.

Observed comparison:

- Local working tree [`src/app/page.tsx`](D:/Projects/AdMate/admate-compass/src/app/page.tsx) includes:
  - `AdMate Compass`
  - `Policy Intelligence Agent`
  - `fetch("/api/admin/users/check-admin")`
  - `useLatestUpdate`
- `HEAD:src/app/page.tsx` still includes:
  - `useDashboardStats`
  - `useChatStats`
  - `useSystemStatus`
  - `useLatestUpdate`
  - old dashboard-style root logic

Production root HTML currently returns:

- HTTP `200`
- `<title>Ad-Mate - AI-powered Meta advertising FAQ chatbot</title>`
- does **not** contain `AdMate Compass`
- does **not** contain `Policy Intelligence Agent`

Conclusion: production is faithfully serving the currently deployed commit, and that commit does not yet contain the desired new root landing.

## 3. Root Page Parity Findings

### 3.1 Local metadata is already Compass-branded

[`src/app/layout.tsx`](D:/Projects/AdMate/admate-compass/src/app/layout.tsx)

- line 7: `title: "AdMate Compass - Policy Intelligence Agent",`
- line 8: Compass description
- line 10: canonical `https://compass.admate.ai.kr`

This means layout metadata in the working tree is Compass-aligned.

### 3.2 Package metadata still carries old product identity

[`package.json`](D:/Projects/AdMate/admate-compass/package.json)

- line 2: `"name": "meta-faq-chatbot"`

This does not directly control the HTML `<title>` in App Router, but it confirms old product naming still exists in repo metadata and may reinforce confusion during deployment review and tooling output.

### 3.3 Production HTML still reflects old user-facing copy

Root fetch result from production:

- status: `200`
- title: `Ad-Mate - AI-powered Meta advertising FAQ chatbot`

This copy does not match the current working-tree Compass landing or Compass metadata intent.

## 4. Public Admin Surface Findings

### 4.1 Deployed root in `HEAD` still imports admin-oriented dashboard hooks

`HEAD:src/app/page.tsx` contains:

- line 36: `import { useDashboardStats, useChatStats, useSystemStatus, useLatestUpdate } from "@/hooks/useDashboardStats";`
- line 48: `useDashboardStats()`
- line 49: `useChatStats()`
- line 50: `useSystemStatus()`
- line 51: `useLatestUpdate()`

Those hooks resolve to the following public fetches in [`src/hooks/useDashboardStats.ts`](D:/Projects/AdMate/admate-compass/src/hooks/useDashboardStats.ts):

- line 72: `fetch('/api/admin/dashboard')`
- line 145: `fetch('/api/admin/status')`

Conclusion: repeated public root calls to `/api/admin/dashboard` and `/api/admin/status` are expected behavior for the currently deployed root implementation.

### 4.2 Current working-tree root partially removes this surface but is not deployed

Current working-tree [`src/app/page.tsx`](D:/Projects/AdMate/admate-compass/src/app/page.tsx):

- keeps `useLatestUpdate`
- replaces dashboard/status/chat hooks with a narrower `check-admin` fetch:
  - line 125: `fetch("/api/admin/users/check-admin", {`

This is better than the old root, but it still means the public root can touch admin-related API surface unless additional gating is added in a later implementation gate.

### 4.3 Admin/debug routes should not be part of the public landing bootstrap path

From a production surface perspective, a public landing page should not eagerly depend on:

- `/api/admin/dashboard`
- `/api/admin/status`
- admin/debug probes that are meaningful only after privileged entry

Even if the route is protected, calling it from public root causes:

- noisy console/network failures
- perceived instability
- unnecessary privileged surface exposure
- weaker trust on first paint

Conclusion: this is a valid production surface defect.

## 5. `/chat-ollama` Auth Redirect Findings

[`src/app/chat-ollama/page.tsx`](D:/Projects/AdMate/admate-compass/src/app/chat-ollama/page.tsx)

- line 140: `// 로그인하지 않은 사용자는 메인 페이지로 리다이렉트`
- line 141: `window.location.href = '/';`
- line 941: `로그인이 필요합니다`

Conclusion:

- unauthenticated users are redirected to `/`
- production read-only visual QA of `/chat-ollama` is limited unless authenticated
- this redirect behavior explains why anonymous production QA sees `/` rather than the evidence workspace

## 6. Production API Contract Checks

### 6.1 Production root

- `GET https://compass.admate.ai.kr/` -> `200`

### 6.2 Production chat endpoint

`POST https://compass.admate.ai.kr/api/chat-ollama`

Observed response shape in production included:

- `response.schema = "compass"`
- `response.noDataFound = false`
- `response.sources.length = 3`
- top-level `model = "ollama-connection-failed"`

Conclusion:

- Compass schema is present in the production response payload
- verified sources are preserved even when generation fails
- source preservation behavior is intact for this audited case

## 7. Local Verification Results

### `npm run type-check`

Pass

### `npm run build`

Pass

Notes:

- local build uses current working-tree files
- local build output for `/` is smaller than the deployment build that still reflects the older root page, which is consistent with the local working-tree landing rewrite not yet being part of the pushed commit

### `npm run verify:harness`

Pass with review warnings.

Observed summary:

- `check-rag-contract`: ok
- fixture evaluation: `20/20`
- `check-admin-debug-surface`: `ok (25 review warnings)`

The warnings reinforce that admin/debug exposure remains an active review area.

## 8. Root Cause Assessment

### P0. Production parity mismatch is caused by uncommitted local UI work

The desired Compass landing is currently present in the working tree but absent from the deployed commit. Because production is built from the pushed commit, production still shows the older Meta FAQ root.

### P1. Public root still bootstraps admin-oriented network calls in deployed `HEAD`

The deployed root imports hooks that call `/api/admin/dashboard` and `/api/admin/status`. Those calls are inappropriate for a public landing surface and explain the repeated `500` behavior observed in production root QA.

### P1. Anonymous production QA of `/chat-ollama` is intentionally constrained by redirect logic

This is not itself the parity bug, but it explains why production evidence UI cannot be fully inspected without authentication.

## 9. Risks

1. Product trust risk:
   public root still presents stale brand/copy and admin noise rather than the intended Compass landing.

2. Surface hygiene risk:
   public root bootstraps admin-oriented endpoints that should not participate in anonymous landing rendering.

3. QA blind spot:
   unauthenticated `/chat-ollama` redirect reduces easy production verification of answer/evidence presentation.

## 10. Recommended Next Gate

Recommended next implementation gate:

`Gate Compass-Production-2 root parity ship and public admin surface removal`

Scope should be narrowly limited to:

1. ship the intended Compass landing from working tree to committed source
2. remove public root dependency on `/api/admin/dashboard` and `/api/admin/status`
3. review whether `/api/admin/users/check-admin` should also be deferred behind authenticated state or user action
4. re-run production smoke after deployment

## 11. Final Judgment

### Production root parity

Fail

Reason:
production is aligned with deployed Git `HEAD`, but deployed `HEAD` is still the old root, while the intended Compass landing remains local dirty work only.

### Public admin surface hygiene

Fail

Reason:
the deployed public root still triggers admin-oriented endpoints on load.

### Vercel repo/branch linkage

Pass

Reason:
Vercel is linked to `Jhongjin/admate-compass`, branch `main`, and the latest pushed commit.
