# Compass GraphRAG Operation Gate v1

Date: 2026-06-20 KST
Repo: admate-compass
Status: local gate closed, production mutation not run

## Scope

Close the operational safety gate around Compass Evidence Graph / GraphRAG without running production SQL, DB mutation, or official guide graph backfill.

## Confirmed Boundaries

- Evidence Graph retrieval remains opt-in through `COMPASS_EVIDENCE_GRAPH_ENABLED`.
- Official guide graph indexing remains controlled through `COMPASS_OFFICIAL_GUIDE_GRAPH_INDEXING_ENABLED`.
- Official guide assertions must remain `source_kind='official_doc'`, `evidence_decision='verified'`, and `review_status='approved'`.
- Resolved case assertions are retrievable only after reviewed promotion and `approved_for_retrieval=true`.
- Backfill route remains admin-session guarded.
- Backfill defaults to `dryRun`.
- Commit mode requires `confirm: "index-official-graph"`.
- Backfill reads existing chunks and must not crawl new pages, delete chunks, or create placeholder chunks.
- Backfill failure responses no longer return raw exception messages.

## Verification

Passed locally:

```text
npm run check:compass-evidence-graph-contract
npm run check:admin-debug-surface
npm run type-check
```

## Not Run

- No production SQL was executed.
- No official guide graph backfill request was sent.
- No DB/Auth mutation was performed.
- No source proposal persistence or promotion was executed.
- No crawler/reembedding job was run.

## Remaining Human-Gated Work

1. Run a dry-run batch against one vendor and review matched documents.
2. Run a small confirmed batch only after target approval.
3. Review assertion quality by vendor and claim type.
4. Expand batches gradually if source precision is stable.
5. Keep rollback/stale assertion behavior ready before any broad backfill.
