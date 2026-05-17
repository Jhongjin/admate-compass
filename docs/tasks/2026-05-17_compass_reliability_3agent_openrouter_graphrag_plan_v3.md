# Compass Reliability v3 - Three-Agent Reviewer, OpenRouter, GraphRAG, and Source Collection Plan

Date: 2026-05-17
Repo: admate-compass
Status: decision record

## External Check

OpenAI:

- OpenAI docs list GPT-5.5 as the latest flagship/frontier model for complex reasoning and professional work.
- GPT-5.5 has a large context window and supports high reasoning effort.
- Source: https://developers.openai.com/api/docs/models
- Source: https://developers.openai.com/api/docs/models/gpt-5.5

OpenRouter:

- OpenRouter supports ordered model fallbacks with the `models` parameter.
- OpenRouter supports provider routing preferences, provider order, fallbacks, latency/throughput/price sorting, and provider data-retention controls.
- Source: https://openrouter.ai/docs/guides/routing/model-fallbacks
- Source: https://openrouter.ai/docs/guides/routing/provider-selection

GraphRAG:

- Microsoft GraphRAG is a structured, hierarchical RAG approach that extracts entities, relationships, claims, community hierarchy, and summaries from raw text.
- It is strongest for connecting information across disparate documents and for holistic questions over large corpora.
- Source: https://microsoft.github.io/graphrag/

## Decision

Compass should maximize trust by strengthening evidence governance first, not by switching the runtime to a new graph stack immediately.

Recommended target:

- Make `/api/chat-ollama` the canonical answer runtime.
- Treat `/api/chatbot` as legacy until removed or adapted.
- Use OpenRouter as the future answer-model gateway.
- Add a three-agent reviewer contract before changing production retrieval.
- Run GraphRAG as a sidecar POC after corpus quality, source freshness, and embeddings are improved.
- Keep source collection backend-driven and proposal-only.
- Keep frontend source management read-only for operators.

## Three-Agent Answer Architecture

Agent 1: Policy Evidence Agent

- Pulls policy, review-rule, eligibility, disapproval, and enforcement evidence.
- Emits structured evidence packets only.
- Does not write final user prose.

Agent 2: Media/Product Evidence Agent

- Pulls product, format, placement, campaign setup, budget, targeting, and operating-condition evidence.
- Uses independent query expansion from Agent 1.
- Emits structured evidence packets only.
- Does not write final user prose.

Team Lead Reviewer

- Receives only evidence packets and source metadata.
- Deduplicates overlapping evidence.
- Detects conflict, stale source, weak evidence, vendor mismatch, and placeholder content.
- Returns `noDataFound` when the evidence is insufficient.
- Produces final answer only from verified evidence.

This is not a majority-vote answer system. It is an evidence review system.

## Evidence Packet Contract

Each retrieval agent should produce packets with at least:

- `claim`
- `sourceId`
- `sourceUrl`
- `sourceTitle`
- `vendor`
- `topic`
- `publishedOrFetchedAt`
- `excerpt`
- `chunkId`
- `retrievalScore`
- `evidenceDecision`
- `reasons`

The Team Lead may use only packets with verified source lineage. Rejected, fallback, placeholder, and weak-only packets must not become final answer content.

## LLM Policy

Future production gateway:

- OpenRouter first when configured.
- OpenRouter first means an approved explicit provider selection, not an
  accidental switch caused only by a server-side key appearing in `auto` mode.
- Local Ollama remains development/failure-isolation fallback only.
- Provider/model metadata should be logged without secret values.
- Evidence decision must remain separate from model output.

Recommended model policy:

- Team Lead Reviewer: highest-accuracy model available through the configured gateway. Prefer OpenAI GPT-5.5 when directly available and approved, or an ordered OpenRouter fallback list across high-accuracy OpenAI, Claude, and Gemini models.
- Agent 1 and Agent 2: high-accuracy extraction-capable models, allowed to use cheaper/faster variants only after fixture evaluation shows no source precision loss.
- Do not hardcode the final model list into code until OpenRouter availability and cost policy are confirmed. Keep it configuration-driven.

OpenRouter features to use later:

- ordered `models` fallback
- provider order/allow/ignore controls
- `allow_fallbacks`
- latency/throughput/price sorting for non-critical helper tasks
- data-retention/provider restrictions for sensitive contexts

## GraphRAG Position

GraphRAG can help Compass, but not as the first production reliability move.

Good Compass use cases:

- questions spanning many platform policy pages
- conflicts between policy, product docs, and help-center wording
- entity relationships such as vendor, placement, format, objective, policy rule, and enforcement reason
- corpus-level summaries for source audit and stale-area detection

Do not use GraphRAG first for:

- single-policy lookup
- exact citation answers
- no-data boundary decisions
- production answer routing before evaluation

Recommended first GraphRAG shape:

- sidecar index only
- local or staging only
- read-only output
- compare against current vector RAG fixtures
- Local Search for entity-specific policy questions
- Global Search only for expensive corpus-wide questions
- never promote graph output without canonical source URL trace

## Crawling and Chunking Upgrade

Primary maintenance flow should be AI/backend-driven, not manual user upload.

Frontend should expose:

- source coverage
- last seen / stale status
- candidate proposals
- diff summaries
- approval state
- queue state
- read-only source health

Frontend should not expose primary crawl/upload/promote controls to normal users.

Backend source watch should:

- watch official allowlisted policy URLs
- fetch candidate content on a schedule
- preserve canonical URL, effective URL, title, content hash, fetched time, and source type
- detect changed/stale/duplicate/low-signal sources
- store proposal snapshots first
- promote to corpus only through explicit approval/apply

Chunking should move toward:

- heading-aware chunks
- table/list preservation
- stable chunk IDs
- overlap tuned by section type
- vendor/topic/source metadata on every chunk
- content-hash dedupe
- stale-source markers
- placeholder and boilerplate rejection

Extraction should move toward:

- real PDF extraction
- real DOCX extraction
- HTML readability extraction
- table extraction for policy matrices
- optional OCR only for image-heavy documents

## Implementation Sequence

Phase 0: documentation and contracts

- keep this decision record
- add fixture-only three-agent contract
- add conflict/no-data/stale/placeholder tests

Phase 1: canonical answer path

- mark `/api/chat-ollama` canonical
- isolate `/api/chatbot` as legacy
- ensure source cards, no-data, and rejected evidence behavior match

Phase 2: source watch queue

- keep proposal queue SQL as manual-only production apply
- run local/staging dry-run queue first
- keep production POST/session path blocked until authenticated internal worker exists

Phase 3: retrieval quality

- replace hash embeddings before judging GraphRAG
- add reranking and source precision evals
- improve chunk provenance and freshness scoring

Phase 4: three-agent reviewer

- implement Agent 1 and Agent 2 as evidence packet producers
- implement Team Lead as final evidence gate
- run only against fixtures until evals are green

Phase 5: GraphRAG sidecar

- build local/staging graph sidecar
- compare hard questions against vector RAG
- promote only if source precision improves without lowering no-data precision

## Commander Answer

Use a three-agent reviewer architecture, OpenRouter as the model gateway, and GraphRAG as a measured sidecar POC.

The strongest near-term accuracy gain is not the graph itself. It is better source freshness, chunk provenance, embedding quality, independent evidence extraction, and a Team Lead reviewer that refuses weak answers.
