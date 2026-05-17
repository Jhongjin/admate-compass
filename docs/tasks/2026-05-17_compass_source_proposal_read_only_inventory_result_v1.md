# Compass Source Proposal Read-Only Inventory Result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Expanded the Compass source proposal operator surface so `/admin/source-ops`
shows a richer read-only inventory of queued AI/backend-agent source proposals.

This pass does not add approve, reject, crawl, chunk, index, promote, upload,
delete, reindex, embedding, LLM, production persistence, or production apply
behavior.

## Changed Behavior

- `GET /api/admin/source-ops/proposals` now accepts a bounded `queueLimit`
  query parameter for read-only queue inventory display.
- `readCompassSourceProposalQueueSnapshot()` now returns safe display fields
  from `source_proposal_queue`, including URL, host, canonical URL, title,
  content preview, content length, fetched timestamp, source status, reason,
  run id, and created timestamp.
- `/admin/source-ops` now calls:

```text
/api/admin/source-ops/proposals?maxSources=7&queueLimit=20
```

- The admin page now renders "AI 제안 소스 검토 인벤토리" as a read-only
  pending-review table.

## Read-Only Boundary

Visible operator affordances are intentionally non-mutating:

- `읽기 전용 큐`
- `승인 기능 준비중`
- `read-only`

The UI does not call `POST /api/admin/source-ops/proposals`,
`POST /api/internal/source-proposals/dry-run`, or `fetch=true`.

## No-Touch Confirmation

This pass did not touch:

- `next-env.d.ts`
- SQL migrations or grants
- `/admin/docs` manual crawler/upload/delete/reindex flows
- document/chunk/vector/embedding services
- production queue persistence or apply behavior
- secrets, env values, service-role values, cookies, tokens, or session data

## Validation

Expected validation:

```text
npm run check:compass-source-ops-contract
npm run check:compass-source-proposal-contract
npm run check:compass-source-proposal-queue-contract
npm run check:compass-source-proposal-worker-contract
npm run type-check
npm run verify:harness
```
