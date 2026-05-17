# Compass Source Proposal Worker Smoke Plan v1

Date: 2026-05-17

## Scope

Prepare a local/staging-only smoke harness for the internal Compass source proposal dry-run worker.

The smoke posts only:

```json
{ "dryRun": true, "maxSources": 1, "fetch": false }
```

The worker path remains proposal-only. It must not fetch previews, index documents, promote candidates, write corpus rows, generate embeddings, or call LLM providers.

## Environment Boundary

Allowed smoke environments:

- `COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_ENV=local`
- `COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_ENV=staging`

Production is prohibited. The smoke script refuses to run when either guard is present:

- `NODE_ENV=production`
- `VERCEL_ENV=production`

The default endpoint is local only:

```text
http://127.0.0.1:3000/api/internal/source-proposals/dry-run
```

Staging must be selected explicitly with `COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_URL`.

Extra endpoint protection:

- local smoke accepts only `localhost` or `127.0.0.1`
- staging smoke refuses production-like `admate.ai.kr` hosts unless the hostname
  clearly includes a non-production hint such as staging, preview, dev, test, or
  local

## Required Variables

Use placeholders in committed examples only. Real values must stay in local or staging secret stores.

- `COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_ENV`
- `COMPASS_SOURCE_PROPOSAL_WORKER_KEY`
- `COMPASS_SOURCE_PROPOSAL_WORKER_ENABLED=true`
- `COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `COMPASS_DB_SCHEMA`
- Optional: `COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_URL`

The worker key and service role key must never be printed.

## Assertions

The smoke checks:

- HTTP response is successful JSON.
- `success=true`.
- `dryRun=true`.
- `mutationEnabled=false`.
- `fetchEnabled=false`.
- Queue persistence is enabled and persisted outside production.
- Queue snapshot is readable with `readStatus="ready"`.
- If a `runId` is returned, the script reads only the configured local/staging Compass schema and verifies:
  - `source_proposal_runs.dry_run=true`
  - `source_proposal_runs.mutation_enabled=false`
  - `source_proposal_runs.fetch_enabled=false`
  - `source_proposal_queue.would_index=false`
  - `source_proposal_queue.would_promote=false`
  - `source_proposal_queue.review_status="pending"`

If service readback variables are absent after a `runId` is returned, the script fails with a sanitized missing-variable message and prints no values.

## Output

The smoke prints only a non-secret summary:

- endpoint host
- schema, if configured
- run id
- candidate count
- pending count

## Deterministic Checks

Safe checks that do not require a real worker key or live environment:

```bash
npm run check:compass-source-proposal-worker-contract
npm run check:compass-source-proposal-queue-contract
npm run check:compass-source-proposal-contract
npm run type-check
```

Do not add `smoke:compass-source-proposal-worker` to `verify:harness`; it requires local/staging secrets and a live local or staging app.
