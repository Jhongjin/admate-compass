# Compass Source Proposal Review Snapshot Conflict Contract Result v1

Date: 2026-05-26

## Scope

- Added a deterministic local classifier for approve/reject source proposal review decision envelopes.
- Covered accepted current snapshots, exact idempotent replays, stale snapshot conflicts, idempotency key reuse conflicts, and malformed envelopes.
- Kept the contract non-mutating: `mutationEnabled=false`, `llmUsed=false`, `noCorpusMutation=true`, and `noApplyAction=true`.

## Verification

- `npm run check:compass-source-proposal-review-decision-contract` passed.
- `npm run check:compass-source-proposal-queue-contract` passed.
- `npm run check:compass-web-page-extraction` passed.
- `npm run check:rag-source-quality:fixtures` passed.
- `npm run type-check` passed.

## Notes

- No apply path, corpus promotion, database, environment, network, cron, or LLM behavior was added.
- `next-env.d.ts` was already dirty and was not edited.
