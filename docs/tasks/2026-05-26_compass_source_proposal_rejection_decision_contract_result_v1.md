# Compass source proposal rejection decision contract result v1

Date: 2026-05-26
Repo: admate-compass
Status: implemented

## Scope

Added a rejection-only review decision contract to
`CompassSourceProposalReviewService`.

Added:

- `buildCompassSourceProposalRejectionDecision()`
- `docs/rag/compass-source-proposal-review-decision-contract-fixtures.json`
- `scripts/check-compass-source-proposal-review-decision-contract.mjs`
- `check:compass-source-proposal-review-decision-contract`

## Boundary

The contract is deterministic and local-only. It accepts explicit actor,
reason, snapshot, timestamp, and idempotency inputs, then returns a sanitized
audit envelope for `decision: 'reject'`.

It does not add:

- approve, apply, promote, or corpus write semantics
- route, UI, SQL, database, Vercel, env, or secret changes
- network, DB, LLM, embedding, indexing, or environment reads

The checker executes the actual service function against fixtures and verifies
sanitization, deterministic fingerprints, idempotency metadata, current
snapshot expectations, and the absence of approval/apply/corpus mutation fields.
