# Deterministic vs Non-Deterministic Work Rules

Use deterministic scripts when the same input should always produce the same pass/fail result.

Deterministic in Compass:
- RAG API response contract: `sources`, `confidence`, `processingTime`, `model`, `isLLMGenerated`.
- Search options: threshold, result count, document type filter.
- Required indexing/search service files.
- Optional sample response validation for source metadata shape.
- Secret/debug surface checks that must not print secret values.

Non-deterministic in Compass:
- Whether an answer is persuasive or clear.
- Which policy nuance to highlight for a media planner.
- Retrieval tuning strategy and query rewriting heuristics.
- Multi-model answer comparison and RAG prompt refinement.

Default rule:
If a check can be expressed as a stable schema, file presence, field range, or forbidden pattern, put it in `scripts/`. If it requires judgment, put it in a skill or review checklist.
