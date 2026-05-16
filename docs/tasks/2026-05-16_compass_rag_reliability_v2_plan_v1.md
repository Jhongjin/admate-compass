# Compass RAG Reliability v2 Plan v1

Date: 2026-05-16
Repo: admate-compass
Status: planning record

## Objective

Compass must answer media, ad product, and policy questions with high source fidelity. The next reliability lane should improve groundedness before adding more visible UI.

The target architecture is a three-agent evidence workflow:

- Team Lead: final answer owner, contradiction checker, citation gatekeeper.
- Agent 1: policy/review rule evidence collector.
- Agent 2: media product/spec/operating condition evidence collector.

The key rule: specialist agents produce evidence packets, not final prose. The Team Lead may answer only from verified evidence.

## Current Baseline

Useful existing foundation:

- `src/lib/services/RAGSearchService.ts` already has hybrid vector/keyword retrieval, intent detection, vendor/topic scoring, source quality warnings, dedupe/ranking, and no-data boundaries.
- `src/components/chat/SourceStatePanel.tsx` and related UI now expose source state more clearly.
- Existing harnesses already cover RAG contracts, source quality samples, no-data boundaries, and UI state fixtures.

Known reliability risks:

- `src/lib/services/SimpleEmbeddingService.ts` uses hash-based fallback embeddings, which is not enough for high-stakes policy retrieval.
- `src/lib/services/DocumentProcessingService.ts` can store placeholder content for PDF/DOCX/URL cases.
- `src/lib/services/TextChunkingService.ts` uses mostly fixed-size recursive character chunks and does not preserve precise source positions.
- `src/lib/services/MetaCrawlingService.ts` and `AlternativeCrawlingService.ts` use brittle HTML/RSS/static fallback extraction.

## Evidence Contract

Introduce a source-side evidence contract before changing answer generation:

```ts
type EvidenceDecision = 'verified' | 'weak' | 'rejected';

interface CompassEvidencePacket {
  claim: string;
  sourceId: string;
  documentId: string;
  documentTitle: string;
  sourceUrl?: string;
  excerpt: string;
  retrievalMethod: 'vector' | 'keyword' | 'hybrid' | 'fallback';
  corpus: string;
  vendor?: string;
  topic?: string;
  score: number;
  evidenceDecision: EvidenceDecision;
  evidenceDecisionReason: string[];
  updatedAt?: string;
}
```

Minimum answer policy:

- If verified evidence exists: answer with citations and confidence.
- If verified evidence exists but generation fails: return generation-limited with preserved evidence.
- If only weak/rejected evidence exists: return noData or clarification prompts.
- If vendors conflict: Team Lead must state uncertainty or ask a narrower question.

## Implementation Phases

### Phase 1 - Contract and Fixtures

Low-risk docs/test lane.

- Add evidence decision expectations to fixtures.
- Add rejected placeholder-content cases.
- Add vendor mismatch cases.
- Add generation-limited with preserved evidence cases.
- Keep current API fields compatible.

Recommended checks:

```powershell
npm run type-check
npm run check:rag-contract
npm run check:rag-source-quality:sample
npm run check:nodata-boundary
npm run evaluate:rag-fixtures
npm run verify:harness
```

### Phase 2 - Runtime Evidence Decisions

Low-risk runtime change inside retrieval layer.

- Extract scoring thresholds in `RAGSearchService.ts` into named constants.
- Add `evidenceDecision` and `evidenceDecisionReason`.
- Mark placeholder crawler/PDF/DOCX content as rejected.
- Preserve existing response fields for UI compatibility.
- Expose source-only diagnostics for candidate versus final evidence review.

### Phase 3 - Crawler and Chunker v2

Improve source quality before GraphRAG.

Crawler metadata:

- canonical URL
- source authority
- locale
- crawled_at
- last_modified or etag where available
- content hash
- source vendor
- extraction method

Chunk metadata:

- heading path
- section title
- clause/table/list type
- source URL
- start/end offsets where possible
- parent document/section id
- content hash

Chunking strategy:

- heading-aware sections first
- numbered policy clauses
- table/list-specific chunks
- parent-child chunks
- sentence-window snippets for answer citations

### Phase 4 - Embedding and Reranking

High-value but requires environment/provider decision.

- Replace hash fallback as the primary production retrieval embedding.
- Keep fallback only for offline synthetic tests.
- Add reranking after broad hybrid retrieval.
- Log retrieval method and rerank reason without exposing secrets.

Human-needed later:

- Any paid model/API key or provider secret registration.
- Any production migration or reindex apply.

### Phase 5 - GraphRAG Lite POC

Do not make GraphRAG the first production dependency.

Sidecar-only POC:

- Create local graph from existing metadata and fixtures.
- Model edges: vendor -> product/policy doc -> section -> topic -> claim.
- Use graph only for query expansion, rerank explanation, and conflict detection.
- Do not use graph output as sole answer evidence.

Promotion gate:

- Better citation accuracy.
- Better vendor/topic disambiguation.
- Fewer false positives.
- No degradation in noData boundaries.

## First Work Items

1. Add fixture schema for `CompassEvidencePacket`.
2. Add no-runtime test fixtures for evidence decisions.
3. Add placeholder-content rejection fixtures.
4. Add threshold constants and evidence decision mapping in `RAGSearchService.ts`.
5. Add diagnostics for candidate collection versus verified evidence.
6. Begin crawler/chunker v2 metadata design.

## Commander Priority

This lane takes precedence over additional Compass visual polish, because the user-facing promise of Compass is correctness and trust at the campaign front line.
