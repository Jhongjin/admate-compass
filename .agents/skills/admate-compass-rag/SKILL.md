---
name: admate-compass-rag
description: Use when working on AdMate Compass policy and guide RAG, including crawling, document indexing, hybrid search, answer grounding, source traceability, confidence handling, and policy-answer quality review.
---

# AdMate Compass RAG Skill

Use this skill for Compass RAG work.

## Operating Rules

- Preserve source traceability in user-facing answers.
- Prefer grounded excerpts and document metadata over unsupported model fluency.
- Keep deterministic checks in `scripts/` and run `npm run verify:harness` after RAG contract changes.
- Treat admin/debug endpoints as sensitive surfaces.
- Never read or output credential values from `.env*` files.

## Deterministic Checks

Run:

```bash
npm run verify:harness
```

For sample response validation:

```bash
npm run check:rag-source-quality -- path/to/sample-response.json
```

## Handoff Boundaries

- Route workflow execution, Slack, audit, and Hermes learning work to Openclaw/Agent Core.
- Route capture/evidence work to Lens.
- Route executive dashboard UI display work to Homepage.
- Route source-of-truth strategy updates to admate-docs.
