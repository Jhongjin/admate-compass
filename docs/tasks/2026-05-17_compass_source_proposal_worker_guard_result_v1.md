# Compass source proposal worker guard result

Date: 2026-05-17
Repo: admate-compass
Status: completed

## Scope

Added a dedicated non-production internal dry-run worker route for Compass source proposal queue persistence.

Route:

- `POST /api/internal/source-proposals/dry-run`

## Safety Boundary

The worker route:

- returns `404` in production before any worker authentication or queue persistence
- requires `COMPASS_SOURCE_PROPOSAL_WORKER_ENABLED=true`
- requires a Bearer worker secret from `COMPASS_SOURCE_PROPOSAL_WORKER_KEY` or `CRON_SECRET`
- requires request body `dryRun: true`
- calls only proposal generation and proposal queue persistence
- returns queue readback through `readCompassSourceProposalQueueSnapshot`
- does not import or call corpus mutation, chunking, embedding, indexing, or answer generation APIs

The route is for local/staging dry-run worker verification only. It is not a production queue-write path.

## Changed Files

- `src/app/api/internal/source-proposals/dry-run/route.ts`
- `scripts/check-compass-source-proposal-worker-contract.mjs`
- `package.json`

## Verification

```powershell
npm run check:compass-source-proposal-worker-contract
npm run check:compass-source-proposal-queue-contract
npm run check:compass-source-proposal-contract
npm run type-check
npm run verify:harness
npm run build
```

All checks passed.

## Next Step

Use this route only in a local/staging environment with explicit worker enablement and a non-production worker key.

Production queue persistence remains blocked until an authenticated internal production apply path is separately designed, approved, and documented.

