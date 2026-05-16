# Compass RAG Reliability v2 - GraphRAG and OpenRouter Plan

Date: 2026-05-16
Status: planning record

## Decision

Compass should continue improving the current evidence-first vector RAG path before introducing GraphRAG as a runtime dependency.

Recommended sequence:

1. Keep the current answer runtime provider boundary and use OpenRouter only as the external LLM gateway when a key is registered.
2. Keep source collection backend-driven and proposal-only until a durable proposal queue and approval gate exist.
3. Add a three-agent answer contract after source/evidence fixtures are stable:
   - Lead Reviewer: final answer, contradiction handling, citation gating.
   - Retrieval Agent A: source-grounded extraction from indexed policy corpus.
   - Retrieval Agent B: independent retrieval pass with alternate query expansion.
4. Add reranking/eval improvements before GraphRAG.
5. Run GraphRAG Lite as a sidecar POC, not as the default Compass search engine.

## Why Not Switch Directly To GraphRAG

Microsoft GraphRAG indexing extracts entities, relationships, claims, communities, summaries, and embeddings from raw text. That is powerful but heavier than Compass needs for the first reliability step.

Compass needs high-confidence media policy answers. The highest leverage near-term fixes are:

- source provenance
- URL/crawler freshness
- chunk quality
- rejection of weak or placeholder context
- answer provider observability
- fixture-based evaluation
- reviewer-style final answer gating

GraphRAG should help later for questions that cross many policy pages or require entity/relationship context. It should not replace direct source-grounded policy retrieval until it beats the current harness.

## OpenRouter Use

Use OpenRouter as a gateway, not as a reasoning policy.

Recommended Compass model policy:

- default high-accuracy model list through `COMPASS_ANSWER_MODELS`
- provider/fallback telemetry stored with each answer attempt
- source evidence decision preserved separately from LLM output
- local Ollama fallback remains available for development and failure isolation
- no raw secrets in logs or client responses

OpenRouter features worth using later:

- ordered model fallbacks through `models`
- provider preferences for latency/throughput/cost
- selected model returned in the response metadata

## GraphRAG POC Scope

Run only after:

- source proposal queue exists
- official source allowlist exists in data, not only code
- URL extraction proposal snapshots exist
- chunk metadata and source panels are green
- answer eval fixtures cover policy, no-data, conflict, stale-source, and multi-source cases

POC mode:

- local or staging only
- read-only index output
- no production answer routing by default
- compare GraphRAG Local Search against current vector RAG fixtures
- Global Search only for expensive dataset-wide questions

Pass criteria:

- higher source precision than vector RAG on hard multi-policy cases
- no lower no-data precision
- explainable source path back to canonical policy URL
- acceptable indexing cost and refresh time

## Current Completed Work

- `b34530dc2` - answer LLM provider boundary
- `294118ec7` - chunking provenance hardening
- `d687c6e2e` - source ops review console
- `c023eb9e2` - source proposal dry-run API

## External References

- Microsoft GraphRAG Query Overview: https://microsoft.github.io/graphrag/query/overview/
- Microsoft GraphRAG Indexing Overview: https://microsoft.github.io/graphrag/index/overview/
- OpenRouter Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter Provider Routing: https://openrouter.ai/docs/guides/routing/provider-selection
