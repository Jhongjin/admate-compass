# RAG-4A SkillOpt Adoption Decision

Date: 2026-06-15

Scope: evaluate whether Microsoft SkillOpt concepts should be applied to AdMate Compass before open beta.

## Source Review

- AI Times article: https://www.aitimes.com/news/articleView.html?idxno=211674
- Microsoft SkillOpt repository: https://github.com/microsoft/SkillOpt

The article and repository describe a skill-document optimization loop: collect task outcomes, let a separate optimizer propose bounded edits to a skill document, and accept edits only when a held-out validation gate improves. The deployed target model is not retrained, and the optimized artifact remains a compact skill document.

## Commander Decision

Adopt the pattern, but do not connect automatic runtime self-modification to production answers before open beta.

Reason:

- Compass answers are policy and media-guide responses, so source grounding is more important than unconstrained fluency.
- Recent failures were caused by retrieval coverage, candidate merging, and answer-format drift. These are best protected by deterministic checks plus reviewed skill edits.
- Automatic prompt mutation in production could improve one query while weakening another vendor or source-traceability path.

## Applied Now

The local Compass RAG skill was updated at `.agents/skills/admate-compass-rag/SKILL.md` with:

- user-facing Korean answer labels for broad media product-structure questions;
- forbidden internal labels and awkward expressions;
- minimum coverage expectations for META, GOOGLE, NAVER, and KAKAO;
- an offline SkillOpt-style loop using feedback, QA notes, candidate skill edits, and held-out validation gates.

## Operating Loop

1. Collect feedback from `compass.feedback`, `compass.learning_feedback`, QA screenshots, and production smoke tests.
2. Group repeated failures by vendor, topic, missing source type, answer style, and latency.
3. Propose a small skill or contract edit.
4. Run:

```bash
npm run check:compass-product-structure-answer-contract
npm run type-check
npm run build
```

5. Run production smoke questions for META, GOOGLE, NAVER, and KAKAO.
6. Accept the edit only when quality improves without losing source grounding or required vendor coverage.

## Later Candidate

After open beta, a separate offline job can export anonymized feedback rows and run a SkillOpt-like optimizer against a held-out Compass QA suite. The output should be a proposed markdown patch, not a direct production deployment.
