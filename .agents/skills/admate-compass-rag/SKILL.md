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

## Answer Quality Skill

For broad media product-structure questions such as "Meta 광고 상품에 대해 알려줘" or
"네이버 광고 상품 종류에 대해 알려줘", keep answers grounded but practical:

- Explain the media structure as a decision flow, not as a flat product list.
- Use user-facing Korean labels:
  - `캠페인 목표부터 정하기`
  - `목표에 맞는 광고 형식과 노출 위치 확인하기`
  - `판매·카탈로그 운영 기능 확인하기`
  - `상황별 빠른 선택 기준`
- Avoid internal or awkward labels such as `실무 선택 기준`, `먼저 고르는 것`, `그다음 고르는 것`, `고정 상품 목록`, or `상품명 하나`.
- Preserve compact bullets. One sentence per bullet is usually enough.
- End with a short practical summary and source markers.
- Do not add ungrounded market commentary, current news, or unsupported performance claims.

Minimum product-structure coverage:

- META: campaign objectives, image/video/carousel/collection formats, placements, catalog or Advantage+ catalog use.
- GOOGLE: app campaigns, shopping ads, search/display context, lead form extensions, creative assets.
- NAVER: 사이트검색광고, 쇼핑검색광고, 쇼핑블록 or major shopping placements, registration or DB conditions when relevant.
- KAKAO: 비즈보드/display context, 상품가이드, 제작 가이드, 심사 or 집행 기준.

## Skill Optimization Loop

Use SkillOpt-style optimization only as an offline governance loop, not as an
automatic production prompt mutator:

1. Collect failures from `compass.feedback`, `compass.learning_feedback`, QA notes,
   and production smoke outputs.
2. Convert repeated failures into small candidate edits to this skill or to a
   deterministic contract script.
3. Accept an edit only when held-out fixtures and production smoke questions improve
   or remain stable.
4. Reject and record edits that improve fluency but reduce source grounding, vendor
   coverage, or response latency.
5. Keep the deployed skill compact and reviewable.

## Deterministic Checks

Run:

```bash
npm run verify:harness
```

For sample response validation:

```bash
npm run check:rag-source-quality -- path/to/sample-response.json
```

For broad product-structure answer safety:

```bash
npm run check:compass-product-structure-answer-contract
```

## Handoff Boundaries

- Route workflow execution, Slack, audit, and Hermes learning work to Openclaw/Agent Core.
- Route capture/evidence work to Lens.
- Route executive dashboard UI display work to Homepage.
- Route source-of-truth strategy updates to admate-docs.
