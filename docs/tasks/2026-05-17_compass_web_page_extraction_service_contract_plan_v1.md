# Compass WebPageExtractionService contract plan v1

Date: 2026-05-17
Repo: admate-compass
Status: docs and guard only

## Decision

`WebPageExtractionService` is not implemented in this gate.

Compass URL indexing must remain fail-closed until a real extractor is approved.
`DocumentProcessingService.processUrl` remains fail-closed, and
`SimpleDocumentProcessingService.processUrlDocument` remains placeholder-only
and must not be used for indexing.

The existing manual crawling surface is not the approved automated source-watch
path. `HybridCrawlingManager` calls `/api/puppeteer-crawler`, but no matching
route is approved as the automated source-watch path.

The existing admin helper paths that create dummy chunks or null embeddings are
not approved automated collection paths:

- `/api/admin/upload/[documentId]/reindex`
- `/api/admin/direct-process`
- `/api/admin/simple-index`

## Extractor Output Contract

A future `WebPageExtractionService` must return a sanitized extraction envelope,
not raw crawler output:

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

The extractor must only accept allowed official policy hosts and must preserve
source URL/title provenance before any chunking step.

## Required Safety Rules

Before any extracted page can enter queue review or corpus promotion, the
extractor must enforce:

- robots and rate-limit respect
- redirect canonicalization
- maximum byte limits
- HTML script/style/navigation removal
- placeholder and low-signal rejection
- repeated page chrome detection
- Korean and English policy-signal detection
- no raw HTML in queue, logs, chunks, or model prompts
- no credentials, cookies, sessions, tokens, signed URLs, or provider responses
- no private/internal IP or local network fetches
- no direct writes to `documents`, `document_chunks`, `ollama_document_chunks`,
  or embeddings
- no dummy chunks or null-embedding completion as an extraction success state

## Safe Integration Order

1. Build fixture-only extractor parser tests.
2. Add read-only source-quality audit fixtures.
3. Feed sanitized extraction previews into the proposal queue first.
4. Add rejection-only review/apply contract.
5. Add approval/apply only after a separate contract and human approval.
6. Only then connect chunking and embedding promotion.

Do not skip from crawler output directly to corpus chunks.

## Current Safe State

Current production-safe state remains:

- proposal queue first
- separate approval/apply
- URL indexing fail-closed
- source proposal preview parser stays pure and non-mutating
- chunking contract rejects placeholder URL content before embeddings
