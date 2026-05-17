# Compass source proposal worker service refactor result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Refactored the local/staging-only source proposal dry-run worker so the
proposal execution body lives in a reusable service.

Added:

- `src/lib/services/CompassSourceProposalWorkerService.ts`
- `runCompassSourceProposalWorkerDryRun()`

Updated:

- `POST /api/internal/source-proposals/dry-run`
- `scripts/check-compass-source-proposal-worker-contract.mjs`

## Boundary

The route still owns all request boundary checks:

- production returns `404`
- worker enablement must be explicit
- Bearer authentication is required
- request body must include `dryRun: true`

The new service runs only after those route guards pass. It builds a
proposal-only run, persists it through the proposal queue service, and returns
the queue snapshot. It does not own auth, environment checks, secrets, headers,
or HTTP response creation.

## No New Apply Surface

This refactor does not add:

- Vercel Cron
- production worker enablement
- approval, rejection, or promotion APIs
- manual upload/crawl changes
- corpus writes to `documents` or `document_chunks`
- chunking, embedding, indexing, answer generation, LLM, or provider calls
- SQL, Supabase schema changes, n8n edits, or secret/env reads

The worker remains proposal-only and non-production.
