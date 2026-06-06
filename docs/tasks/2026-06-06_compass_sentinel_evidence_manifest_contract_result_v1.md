# Compass Sentinel Evidence Manifest Contract Result v1

Date: 2026-06-06
Repo: admate-compass
Status: implemented

## Scope

Added a local-only Compass RAG evidence manifest contract for future Sentinel display.

This pass does not change production retrieval, answer generation, crawling, indexing, embeddings, database access, provider routing, n8n or live ingest, persistence, apply, or promote behavior.

## Contract

The manifest is sanitized and label/count only. It includes a fixed contract version, evidence status, review status, answer disposition, evidence counts, candidate draft counts, reason codes, an operator-safe summary, and required all-true safety flags.

It intentionally excludes raw source URLs, source ids, document ids, chunk ids, candidate ids, storage or filesystem paths, hashes, raw payloads, account or campaign identifiers, provider strings, secrets, tokens, sessions, cookies, and route/path handoff data.

## Safety Boundary

The service is pure TypeScript. The checker rejects live-call and mutation snippets such as `fetch`, `supabase`, `process.env`, storage/session/cookie access, and insert/update/delete operations. The fixture scanner recursively rejects unsafe keys and strings.

## Validation

Validated:

```text
npm run check:compass-evidence-contract -- ok
npm run check:compass-answer-candidate-review-contract -- ok
npm run check:compass-sentinel-evidence-manifest -- ok
npm run check:compass-source-panel-rendering -- ok
npm run type-check -- ok
npm run verify:harness -- ok
```
