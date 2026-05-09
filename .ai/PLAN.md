# Compass Agent Plan

Before edits:
1. Read `AGENTS.md`, `README.md`, relevant `docs/strategy/*`, and `.ai/*`.
2. Identify whether the task is RAG quality, indexing, admin operations, UI, or deployment.
3. Keep deterministic checks in scripts and flexible judgment in skills/prompts.

Primary priorities:
1. Preserve answer source traceability.
2. Keep RAG retrieval/indexing contracts stable.
3. Avoid exposing raw credentials or raw campaign-level data to LLMs.
4. Route cross-product work to the correct AdMate repo.
