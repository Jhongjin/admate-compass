# Compass Answer Candidate Review Contract Result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Added a fixture-only Team Lead answer-candidate review contract for the
three-agent Compass direction.

This pass does not change production retrieval, answer generation, OpenRouter
activation, GraphRAG, crawling, indexing, embeddings, database access, or any
runtime provider behavior.

## Changed Behavior

- Added `CompassAnswerCandidateReviewService` as a side-effect free local
  contract layer above `reviewCompassEvidencePackets`.
- Specialist agents may submit answer candidates, but those candidates are
  drafts only and must cite verified chunk ids.
- The Team Lead review selects only supported candidates, rejects weak,
  conflicting, placeholder, stale, or unsupported candidates, and returns
  `noDataFound` when verified evidence or supported candidates are missing.
- Added answer, weak-only, conflict, and unsupported-candidate fixture cases in
  `docs/rag/compass-answer-candidate-review-fixtures.json`.
- Added `check:compass-answer-candidate-review-contract` and wired it into
  `verify:harness`.

## Safety Boundary

The service is pure TypeScript and does not call network, database, LLM,
embedding, crawler, source proposal, or provider selection paths. It does not
promote documents, chunks, embeddings, or source proposals.

## Validation

Validated:

```text
npm run check:compass-answer-candidate-review-contract
npm run check:compass-three-agent-reviewer-contract
npm run type-check
npm run verify:harness
npm run build
```
