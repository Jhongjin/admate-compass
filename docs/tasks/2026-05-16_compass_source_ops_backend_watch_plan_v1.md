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
- `/admin/source-ops`
  - read-only admin page for source coverage, cadence, and backend recommendations
- admin navigation item: `소스 관제`
- `npm run check:compass-source-ops-contract`
  - included in `verify:harness`

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

Build `WebPageExtractionService` in proposal mode:

1. fetch allowlisted official source URLs
2. parse HTML with structured extraction, not regex-only stripping
3. remove navigation/page chrome
4. preserve canonical URL, headings, locale, and policy section labels
5. output a proposal object only
6. store nothing unless a future apply gate is explicitly approved

After proposal output exists, add a cron-ready route that remains disabled unless an explicit env flag is set.
