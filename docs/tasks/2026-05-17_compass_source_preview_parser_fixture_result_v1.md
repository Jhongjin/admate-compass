# Compass Source Preview Parser Fixture Result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Split the Compass source proposal HTML preview parser into a side-effect-free
service and added local fixture coverage for extraction behavior.

This pass does not enable crawling, indexing, chunking, embeddings, LLM calls,
database writes, queue approval, or production worker execution.

## Changed Behavior

- Added `src/lib/services/CompassSourcePreviewParser.ts`.
- `CompassSourceProposalService.fetchPreview()` still owns the network boundary.
- The parser now owns only HTML string parsing and validation:
  - title extraction
  - canonical URL extraction
  - `h1`-`h3` heading extraction
  - page chrome removal
  - entity decoding
  - readable policy signal checks
- Added `docs/rag/compass-source-preview-parser-fixtures.json`.
- Added `scripts/check-compass-source-preview-parser-fixtures.mjs`.

## Safety Boundary

The parser fixture check is local-only. It executes static HTML samples and does
not call network, database, embedding, indexing, or answer-generation code.

URL indexing and chunking remain fail-closed. `DocumentIndexingService` and
`DocumentProcessingService` must not import or call the proposal preview parser
until a separate approved crawler/chunking path exists.

## Validation

Validated:

```text
npm run check:compass-source-preview-parser
npm run check:compass-source-proposal-contract
npm run check:compass-chunking-contract
npm run check:rag-contract
npm run type-check
npm run verify:harness
npm run build
```
