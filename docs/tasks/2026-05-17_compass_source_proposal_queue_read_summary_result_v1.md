# Compass Source Proposal Queue Read Summary Result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Extended the `/admin/source-ops` read-only queue surface with lightweight
proposal queue summaries after the production SQL apply/readback succeeded.

This pass does not add approval, rejection, crawling, chunking, indexing,
promotion, embeddings, LLM calls, cron activation, or production worker writes.

## Changed Behavior

- `readCompassSourceProposalQueueSnapshot()` now returns read-only queue counts:
  - `reviewStatusCounts.pending`
  - `reviewStatusCounts.rejected`
  - `reviewStatusCounts.expired`
  - `riskLevelCounts.low`
  - `riskLevelCounts.medium`
  - `riskLevelCounts.high`
- Queue readback and queue write persistence are now separated:
  - `COMPASS_SOURCE_PROPOSAL_QUEUE_READ_ENABLED=true` enables read-only queue status.
  - `COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true` enables non-production dry-run queue persistence.
- `/admin/source-ops` now shows:
  - `검토 상태 분포`
  - `위험도 분포`
- `GET /api/admin/source-ops/proposals` forces preview fetching off in production even if a caller passes `fetch=true`.

## Safety Boundary

The summary queries only `source_proposal_queue` and only with `SELECT` count
operations. The UI remains read-only and still exposes no POST/apply controls.

Production write behavior is unchanged. Queue persistence remains disabled by
default and production worker execution remains blocked until a separate
authenticated internal path is approved. Read-only production status can be
enabled separately after the service-role read boundary is approved.

## Validation

Validated:

```text
npm run check:compass-source-ops-contract
npm run check:compass-source-proposal-contract
npm run check:compass-source-proposal-queue-contract
npm run type-check
npm run verify:harness
npm run build
```
