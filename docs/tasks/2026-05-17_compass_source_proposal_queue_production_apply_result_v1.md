# Compass source proposal queue production apply result

Date: 2026-05-17
Repo: admate-compass
Status: production SQL applied by operator

## Operator Result

The operator applied:

- `docs/sql/2026-05-16_compass_source_proposal_queue.sql`

Reported SQL editor result:

- `Success. No rows returned`

The operator then ran:

- `docs/sql/2026-05-16_compass_source_proposal_queue_verify.sql`

The reported grant readback includes:

- `service_role` has `SELECT`, `INSERT` on `compass.source_proposal_runs`
- `service_role` has `SELECT`, `INSERT`, `UPDATE` on `compass.source_proposal_queue`
- `postgres` owns the broader administrative privileges
- no `anon` or `authenticated` grants were reported

## Interpretation

This matches the expected production boundary for the proposal queue.

The SQL only creates durable proposal queue tables and metadata:

- `compass.source_proposal_runs`
- `compass.source_proposal_queue`
- `compass.update_source_proposal_queue_updated_at()`
- queue indexes
- service-role grants

This SQL does not:

- crawl pages
- upload documents
- write chunks
- generate embeddings
- promote corpus data
- enable source proposal persistence by itself

## Post-Apply Local Contract Checks

```powershell
npm run check:compass-source-proposal-queue-contract
npm run check:compass-source-ops-contract
npm run check:compass-source-proposal-contract
npm run check:admin-debug-surface
```

All checks passed after the operator apply report.

## Current Safety Boundary

Production source proposal writes remain blocked unless a separate authenticated internal worker/apply path is implemented and approved.

The public/admin UI remains read-only for source coverage and queue status. Corpus promotion remains out of scope.

## Next Safe Step

Build the non-production dry-run worker/readback path first:

1. keep production writes blocked
2. run queue persistence only in local/staging with `COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true`
3. verify rows are proposal-only and keep `would_index=false`, `would_promote=false`
4. design the authenticated internal worker path
5. add approval/apply documentation before any production queue write is enabled

