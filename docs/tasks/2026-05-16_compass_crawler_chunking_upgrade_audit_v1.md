# Compass Crawler And Chunking Upgrade Audit

Date: 2026-05-16

## Current State Before Patch

- `DocumentProcessingService.processUrl()` still returns a serverless placeholder instead of a real crawled page.
- `MetaCrawlingService` can fetch HTML, but extraction is regex-based and strips all tags into one flat text stream.
- `TextChunkingService` used generic recursive splitting for URL content.
- Chunk metadata preserved `title` and `url` only indirectly through the LangChain metadata object.
- `VectorStorageService.saveChunks()` did not normalize chunk-level aliases such as `source_url`, `document_url`, `source_title`, or chunking strategy.

## Risks For Compass Accuracy

- Crawled page chrome, login/navigation text, and app payload text can enter the corpus.
- Parent document URL/title can disappear at chunk level, producing source cards with weak provenance.
- Policy clauses can be split without a stable strategy marker, making future corpus audits hard.
- URL content was not using the Korean/policy-aware splitter even though the production question set is Korean-heavy.

## Implemented Low-Risk Patch

No crawler run, DB mutation, schema change, production env change, or embedding generation was performed.

The code now:

- fails closed when `DocumentProcessingService.processUrl()` is used without a real extractor
- prevents serverless URL placeholder text from being embedded as if it were policy content
- tags chunks with `policy-recursive-v2` or `url-policy-recursive-v2`
- applies Korean/policy-aware splitting to URL documents
- normalizes zero-width/control spacing and removes obvious one-line boilerplate before splitting
- computes `signalScore` metadata for future source-quality ranking
- preserves `sourceTitle` and `sourceUrl` metadata before storage
- writes normalized chunk metadata aliases:
  - `source_title`
  - `source_url`
  - `document_url`
  - `chunking_strategy`
  - `signal_score`
- adds `npm run check:compass-chunking-contract` and includes it in `verify:harness`

## Next Safe Step

Prepare a real `WebPageExtractionService` and a read-only corpus audit script that samples existing `document_chunks` for:

- missing `source_url`
- low `signal_score` or missing future equivalent
- repeated navigation strings
- vendor/title mismatch
- likely placeholder URL content

That audit can rank the worst source families without changing production data.

Implemented follow-up:

- `npm run audit:compass-corpus-source-quality`
  - read-only sample audit for `document_chunks` and `ollama_document_chunks`
  - reports missing `source_url`, missing `chunking_strategy`, missing/low `signal_score`, likely placeholder URL content, and likely page chrome
  - reads parent `documents` rows as fallback for title/url/status/type context
  - reports weak policy titles, possible vendor mismatch, and duplicate content fingerprints
  - prints hashed chunk/document tokens, source host, compact buckets, and issue names only; it does not print raw content, metadata, or embeddings
  - skips safely when Compass Supabase environment is unavailable
- `npm run check:compass-corpus-audit-contract`
  - keeps the audit script read-only and redacted
  - included in `verify:harness`

## Later Upgrade Path

1. Add a dedicated crawler extraction layer using a structured parser or crawl worker outside the serverless request path.
2. Store raw archive text separately from vector-ready policy chunks.
3. Promote only high-signal, source-linked chunks into the vector-ready corpus.
4. Add optional GraphRAG sidecar only after clean source identity, chunk metadata, and source-evaluation fixtures are stable.
