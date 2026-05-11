# Compass RAG-3O Ranking Context Patch Result v1

Date: 2026-05-11
Status: implemented
Scope: offline-safe RAG ranking context patch

## Verdict

Decision: PASS

The RAG-3O follow-up was implemented as a narrow offline-safe patch in
`src/lib/services/RAGSearchService.ts`.

The patch preserves generic-policy scoring context during duplicate candidate
merge. Before this change, merged duplicates recalculated score with
`genericPolicyIntent=false` and `originalMetaSeed=false`, which could let a
merged vector/keyword candidate bypass the generic-policy Meta seed demotion or
topic-rescue boost path.

## Changed Behavior

Changed:

- `mergeDedupeAndRankCandidates()` now passes the detected query intent into
  `mergeDuplicateCandidate()`.
- `mergeDuplicateCandidate()` now computes merged score with the real
  generic-policy intent context.
- original Meta seed detection is preserved across either side of the duplicate
  merge.
- merged duplicate scoring still uses the same vector, keyword, lexical,
  source-quality, topic, title, and vendor inputs as before.

Not changed:

- `/api/chat-ollama`
- RAG corpus data
- DB schema
- import/reembedding/crawler paths
- production API behavior by direct smoke
- fixture content
- noData boundary helper

## Verification

Commands run:

```text
npm run type-check
npm run build
npm run verify:harness
node scripts/evaluate-rag-fixtures.mjs --diagnostics
git diff --check -- src/lib/services/RAGSearchService.ts
```

Results:

```text
type-check: pass after build regenerated .next types
build: pass
verify:harness: pass
diagnostics fixture-schema check: pass
git diff --check: pass
```

The first `npm run type-check` attempt failed before build because `.next/types`
contained stale missing file references. After `npm run build` regenerated the
Next type files, `npm run type-check` passed. The generated `next-env.d.ts`
change was restored and not included in this gate.

## No-Touch Confirmation

This gate did not perform:

- production calls
- live RAG evaluation
- login or authenticated browser QA
- SQL execution
- DB mutation
- import, crawler, or reembedding execution
- fixture data changes
- environment variable changes
- secret, token, cookie, session, or raw provider output

## Remaining Follow-Ups

Remaining follow-ups require separate explicit approval:

- live/source-only RAG fixture evaluation
- authenticated Compass UI QA
- production source preservation smoke
- RAG corpus/import/reembedding work

## Final State

The offline-safe RAG-3O ranking context patch is implemented and verified.
