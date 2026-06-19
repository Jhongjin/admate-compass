# Compass RAG Product Structure Answer Gate v1

Date: 2026-06-20 KST
Repo: admate-compass
Status: completed locally

## Scope

Continue the latest open Compass RAG queue after no 2026-06-19 or 2026-06-20 handoff document was found.

The active unfinished work was the dirty Compass RAG product-structure answer branch:

- product-structure and specific-product retrieval routing
- grounded answer source selection
- answer provider fallback boundary
- Evidence Graph complement handling
- public provider-neutral health and logging contracts

## Completed Fixes

- Added the missing `searchMetaProductOverviewPriorityCandidates` retrieval path so broad Meta product-structure questions can prioritize campaign objectives, formats, placements, catalog, pixel, and commerce evidence.
- Removed provider/env-specific console logging from the Compass answer generation failure path.
- Promoted product-structure rescue evidence only after actual evidence text passes the rescue gate, with explicit `verified` decision and rescue reason.
- Narrowed `RAGSearchService.buildCandidateEvidenceText` to user-visible evidence fields instead of diagnostic metadata, URLs, IDs, graph paths, retrieval method, or source-vendor metadata.
- Changed specific-product requested-focus misses from a hard answer-blocking gate into a fallback metadata signal when strict evidence exists.
- Limited app-install supplement queries to Meta and Google vendor contexts.
- Raised remote answer timeout default to 30 seconds and Ollama answer output budget to reduce Korean grounded-answer truncation risk.
- Added `.vercelignore` exclusions for `.env*`, local logs, build output, and dependency/cache artifacts before production deploy.

## Verification

Passed locally:

```text
npm run type-check
npm run check:compass-product-structure-answer-contract
npm run check:compass-answer-route-contract
npm run check:compass-answer-provider-contract
npm run check:compass-public-provider-naming
npm run verify:harness
npm run build
git diff --check
npm run smoke:compass-answer-local
```

`npm run verify:harness` passed the full offline deterministic RAG harness, including source quality, no-data boundary, evidence QA, product-structure answer, provider naming, source proposal, and admin debug surface contracts.

`npm run build` completed successfully with Next.js 15.5.15. The only non-blocking notice was stale Browserslist data.

## Deploy Result

- Target: production
- Deployment ID: `dpl_BR2RjfdqtJhiTYF88Nf117JfyN2S`
- Deployment URL: `https://admate-compass-4f9fqw4v2-jeonhongjins-projects.vercel.app`
- Production alias: `https://compass.admate.ai.kr`
- Status: Ready
- Created: 2026-06-20 03:27 KST
- Public homepage check: `200 OK`
- Public health check: `200 OK`, `status=healthy`
- Error log scan: no production error logs found in the last hour
- Production RAG smoke: `Meta 광고 상품에 대해 알려줘` returned `ok=true`, `noDataFound=false`, `sourcesCount=1`, `model=compass-answer-grounded-product-structure-llm`

Deploy command:

```text
vercel deploy --prod --yes
```

Smoke command:

```text
COMPASS_ANSWER_SMOKE_URL=https://compass.admate.ai.kr/api/compass-answer
COMPASS_ANSWER_SMOKE_QUERY=Meta 광고 상품에 대해 알려줘
npm run smoke:compass-answer-local
```

## Not Run

- No production SQL was executed.
- No DB/Auth mutation was performed.
- One production answer smoke call was made after deploy. No broad paid canary sweep was run.
- No `.env*` secret value was read or printed.

## Remaining Human-Gated Work

- Official guide graph backfill remains a production/data gate and should stay behind explicit target approval.
- Any real provider canary should be run as a separate monitored smoke with latency, cost, and source precision reviewed.
- Production deployment remains outside this local completion record.
