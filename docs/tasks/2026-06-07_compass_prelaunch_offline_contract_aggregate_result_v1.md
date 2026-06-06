# Compass Prelaunch Offline Contract Aggregate Result v1

Date: 2026-06-07
Repo: admate-compass
Status: implemented

## Scope

Added a curated local/offline prelaunch aggregate runner for Compass static and
local contracts, including the Sentinel evidence manifest contract.

Added package scripts:

- `check:compass-prelaunch-offline-contracts`
- `verify:prelaunch-local`

## Included Contracts

The aggregate runs serially and fail-fast:

- `check:rag-contract`
- `check:compass-evidence-contract`
- `check:compass-sentinel-evidence-manifest`
- `check:compass-answer-route-contract`
- `check:compass-answer-provider-contract`
- `check:compass-source-proposal-contract`
- `check:compass-source-proposal-queue-contract`
- `check:compass-source-proposal-worker-contract`

`check:rag-contract` is present in `package.json`, so the aggregate invokes it
through `npm run check:rag-contract`. If that package script is removed later,
the aggregate falls back to `node scripts/check-rag-contract.mjs` so the legacy
RAG contract still remains covered without adding broader harness scope.

## Explicit Exclusions

This aggregate intentionally excludes:

- provider calls
- migration/env/SQL work
- source proposal apply/persist/promote
- worker live execution
- smoke against live services
- authenticated UI smoke
- publish
- campaign mutation

It does not run build, dev, start, migration verification, smoke scripts, live
worker dry runs, publish flows, or campaign mutation flows.

## Safety Boundary

The aggregate validates its package wiring and its own included/excluded arrays
before running component checks. The aggregate script does not read environment
values and does not call external services.

## Validation

Validated:

```text
npm run check:compass-prelaunch-offline-contracts -- ok
npm run verify:prelaunch-local -- ok
npm run check:rag-contract -- ok
npm run check:compass-evidence-contract -- ok
npm run check:compass-sentinel-evidence-manifest -- ok
npm run check:compass-answer-route-contract -- ok
npm run check:compass-answer-provider-contract -- ok
npm run check:compass-source-proposal-contract -- ok
npm run check:compass-source-proposal-queue-contract -- ok
npm run check:compass-source-proposal-worker-contract -- ok
npm run type-check -- ok
git diff --check -- ok
```

Notes:

- `check:compass-answer-route-contract` returned a nonzero status once during a
  parallel verification batch without printing a failure diagnostic; rerunning
  the command standalone passed.
- `git diff --check` exited 0 and printed the existing line-ending warning that
  `package.json` will be converted from LF to CRLF the next time Git touches it.
