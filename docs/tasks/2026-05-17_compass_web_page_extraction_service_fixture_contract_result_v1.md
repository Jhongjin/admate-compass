# Compass WebPageExtractionService fixture contract result v1

Date: 2026-05-17
Repo: admate-compass
Status: fixture-only contract implemented

## Result

Compass now has a pure `WebPageExtractionService` fixture contract for sanitized
web page extraction envelopes. This is not connected to production crawling,
proposal apply, chunking, embedding, or corpus promotion.

The fixture-only gate covers:

- `canonicalUrl`
- `sourceTitle`
- `contentText`
- `contentHash`
- `extractedAt`
- `sourceQuality`
- `boilerplateRemoved`
- `language`
- `headings`
- `policySignals`
- `rejectionReasons`

## Safety Boundary

The service is intentionally local and deterministic. It does not fetch,
read environment variables, create Supabase clients, call LLM providers,
generate embeddings, or write to any corpus table.

Rejected pages return an empty `contentText` and a `rejectionReasons` list.
Fixture coverage blocks raw HTML leakage, secret-like text, private/internal
URLs, non-allowlisted hosts, and placeholder or low-signal content.

## Non-Goals

This gate does not approve:

- production cron activation
- source proposal apply routes or UI actions
- direct promotion to `documents`, `document_chunks`, `ollama_document_chunks`,
  or embeddings
- dummy chunks or null-embedding completion states
- replacing the existing source proposal preview parser

## Verification

The checker is exposed as `npm run check:compass-web-page-extraction` and is
included in `verify:harness`.
