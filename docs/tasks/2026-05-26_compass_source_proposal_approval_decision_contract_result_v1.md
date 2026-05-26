# Compass Source Proposal Approval Decision Contract Result v1

Date: 2026-05-26

## Scope

Implemented the local-only Compass source proposal approval decision contract after the existing rejection decision contract.

## Behavior Added

- Added `buildCompassSourceProposalApprovalDecision()` as a pure deterministic builder in `CompassSourceProposalReviewService`.
- Emits `contract: compass-source-proposal-approval-decision-v1` and `decision: approve`.
- Keeps `mutationEnabled: false` and `llmUsed: false`.
- Allows only `admin` and `internal_worker` actors.
- Requires sanitized `proposalId`, `source.id`, `source.url`, `actor.actorId`, `reason.summary`, `decidedAt`, `reviewSnapshotHash`, and `idempotencyKey`.
- Allows only explicit approval reason codes:
  - `official_policy_source`
  - `fills_policy_gap`
  - `stale_source_refresh`
  - `high_confidence_candidate`
  - `manual_review_passed`
- Emits a sanitized audit envelope with a deterministic `approve_????????` fingerprint.
- Emits approval-for-later-review expectations:
  - `requiresCurrentSnapshot: true`
  - `expectedSnapshotHash`
  - `idempotentBy: ['proposalId', 'decision', 'idempotencyKey']`
  - `noCorpusMutation: true`
  - `noApplyAction: true`
  - `approvedForApplyReviewOnly: true`

## Verification

- `npm run check:compass-source-proposal-review-decision-contract` passed.
- `npm run check:compass-source-proposal-contract` passed.
- `npm run check:compass-source-proposal-queue-contract` passed.
- `npm run check:compass-source-proposal-worker-contract` passed.
- `npm run type-check` passed.

## Residual Risk

No runtime apply path, corpus mutation, cron, SQL, environment, secret, auth, route, or UI behavior was enabled. This remains a local contract fixture/checker update only.
