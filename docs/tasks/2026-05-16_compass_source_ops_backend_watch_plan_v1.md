# Compass Source Ops Backend Watch Plan

Date: 2026-05-16

## Decision

Compass should not rely on operators manually uploading policy URLs or documents as the primary maintenance flow.

Recommended model:

- backend agent owns source watch, discovery, extraction proposals, and refresh cadence
- frontend exposes a read-only source operations console
- manual upload/crawl remains fallback or emergency maintenance only
- any production corpus promotion remains a separate approval/apply step

## Implemented Scope

No crawler run, DB mutation, embedding generation, production env change, or cron activation was performed.

Implemented:

- `CompassSourceOpsService`
  - static source registry for Meta, Kakao, Naver, and Google
  - read-only comparison against stored `documents`
  - per-source status: `indexed`, `stale`, `candidate_only`, `unavailable`
  - explicit `mutationEnabled: false`
- `GET /api/admin/source-ops`
  - returns the source operations plan and safety notes
- `GET /api/admin/source-ops/proposals`
  - returns a proposal-only dry run for source collection candidates
  - does not write documents, chunks, embeddings, or URL templates
  - marks every candidate with `wouldIndex: false` and `wouldPromote: false`
  - includes deterministic review metadata: relevance score, diff summary, recommendation
  - does not call an LLM; `llmUsed` remains `false`
  - keeps network preview fetching disabled unless `COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED=true`
- `POST /api/admin/source-ops/proposals`
  - accepts only `{ "dryRun": true }`
  - persists to the proposal queue only when `COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true`
  - remains blocked in production until a separate authenticated internal apply path exists
- Proposal queue SQL
  - `docs/sql/2026-05-16_compass_source_proposal_queue.sql`
  - `docs/sql/2026-05-16_compass_source_proposal_queue_rollback.sql`
  - `docs/sql/2026-05-16_compass_source_proposal_queue_verify.sql`
  - production SQL apply is a human-only step
- `/admin/source-ops`
  - read-only admin page for source coverage, cadence, and backend recommendations
  - read-only proposal preview table for deterministic relevance/diff summaries
  - no queue/apply/promote/index controls
- admin navigation item: `소스 관제`
- `npm run check:compass-source-ops-contract`
  - included in `verify:harness`
- `npm run check:compass-source-proposal-contract`
  - asserts the proposal path does not import corpus mutation services
  - asserts the proposal path remains dry-run/proposal-only by default
- `npm run check:compass-source-proposal-queue-contract`
  - asserts queue SQL keeps `dry_run`, `mutation_enabled`, `would_index`, and `would_promote` locked safe
  - asserts queue service writes only to `source_proposal_runs` and `source_proposal_queue`
  - asserts production POST is session-blocked
- URL provenance guard
  - `DocumentIndexingService.indexURL()` now persists `documents.url`
  - `npm run check:compass-chunking-contract` verifies the URL path keeps provenance for duplicate detection and source matching

## Safety Boundary

The source ops screen is intentionally not an upload/crawl execution surface.

It can show:

- registered source URLs
- source cadence
- matched documents and chunk counts
- stale/candidate/unavailable status
- backend recommendation text

It must not:

- crawl pages
- upload files
- chunk or embed content
- promote corpus changes
- mutate URL templates

## Next Implementation Step

Promote the proposal queue into a durable backend source-watch job:

1. apply the proposal queue SQL in staging/local Supabase first
2. set the smoke environment to `COMPASS_DB_SCHEMA=compass` and `COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true`
3. run a dry-run POST smoke outside production and verify rows only in `source_proposal_runs` and `source_proposal_queue`
4. design the authenticated internal worker/apply path; production POST remains blocked until that path exists
5. after the worker path is approved, apply the same SQL through the production SQL editor and immediately run the verify SQL
6. run the proposal API from a scheduled backend job that writes only proposal rows
7. add optional AI relevance classification and richer diff summaries after deterministic review remains stable
8. keep production corpus promotion behind an explicit approval/apply gate
9. only after approval, call the existing chunking and embedding path

Production SQL alone does not enable queue persistence. The production API still blocks queue writes until an authenticated internal worker/apply path is implemented and approved.

The current production posture remains non-mutating by default so the UI can confirm coverage before any production SQL, cron activation, or corpus promotion is introduced.
