# Compass Three-Agent Dedupe Fixture Result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Added a fixture-only contract case for the Team Lead Reviewer dedupe boundary.

This pass does not change production retrieval, answer generation, OpenRouter
activation, GraphRAG, crawling, indexing, embeddings, database access, or any
runtime side effects.

## Changed Behavior

- Added `meta-duplicate-evidence-deduped` to
  `docs/rag/compass-three-agent-reviewer-fixtures.json`.
- The case sends the same verified Meta policy claim from both specialist
  agents with the same `sourceId`, `chunkId`, and `claim`.
- `scripts/check-compass-three-agent-reviewer-contract.mjs` now mirrors the
  reviewer service dedupe key and validates:
  - Team Lead verified count is calculated after dedupe.
  - `expectedDedupedPacketCount` matches the deduped packet count.
  - at least one duplicate-evidence fixture exists.

## Safety Boundary

The reviewer remains side-effect free. Specialist agents still emit evidence
packets only. The Team Lead remains the only owner of the final answer gate and
must not count duplicate packets as independent evidence.

## Validation

Validated:

```text
npm run check:compass-three-agent-reviewer-contract
npm run verify:harness
npm run type-check
```
