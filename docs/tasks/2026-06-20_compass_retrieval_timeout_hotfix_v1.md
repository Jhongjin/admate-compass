# Compass Retrieval Timeout Hotfix v1

Date: 2026-06-20 KST
Repo: admate-compass
Status: completed locally, pending production redeploy at write time

## Scope

Fix the production canary regression where `/api/compass-answer` returned `noDataFound=true` for product-structure queries after the runtime env boundary cleanup.

## Finding

The deployment was healthy, and Vercel logs showed Supabase keyword retrieval producing candidates, but broad product-structure canaries were closing as no-data around 11-12 seconds. This matched the default per-channel retrieval timeout rather than a database/env outage.

## Completed Fixes

- Increased the top-level Compass evidence retrieval default budget from 22s to 30s.
- Increased the per-channel RAG retrieval default budget from 11s to 28s.
- Expanded timeout clamp ranges to keep production latency variance inside the 60s Vercel function budget.
- Added timeout metadata to the answer handler so timed-out retrieval is returned as `compass-answer-retrieval-limited`, not authoritative `noDataFound=true`.
- Added product-structure contract checks so these defaults cannot silently regress.

## Verification

Passed locally:

```text
npm run check:compass-product-structure-answer-contract
npm run check:compass-answer-route-contract
npm run type-check
npm run verify:harness
npm run build
git diff --check
```

## Follow-Up

- Re-run production health and product-structure canaries after redeploy.
- Add `COMPASS_RETRIEVAL_CHANNEL_TIMEOUT_MS=28000` to Vercel Production env so production config matches the repo default.
- If long-tail retrieval latency remains high, split the slower Supabase keyword paths into smaller bounded queries rather than raising the budget again.
