# RAG-3O Generic Policy Ranking Evidence Result

## Scope

This pass keeps RAG-3O generic policy ranking/evidence work source-only and local-contract-only. It does not tune production HTTP behavior or change retrieval data, embeddings, schema, crawler behavior, provider defaults, secrets, sessions, Supabase/Vercel/n8n UI, or GraphRAG.

Changed files:

- `src/lib/services/RAGSearchService.ts`
- `scripts/evaluate-rag-fixtures.mjs`
- `scripts/check-rag-contract.mjs`
- `docs/rag/rag-3o-generic-policy-ranking-evidence-result.md`

## Guard Result

`RAGSearchService` already contained the RAG-3O generic-policy ranking guard shape:

- generic policy intent detection
- exact topic and policy-grade title matching
- generic topic rescue candidate/replacement handling
- topic/policy rank reasons
- generic Meta seed score demotion

This pass only surfaced the generic vector Meta seed demotion in `rankReason` as `generic_vector_seed_penalty`, using the same condition as the score penalty.

## Diagnostics

`scripts/evaluate-rag-fixtures.mjs` diagnostic summaries now expose:

- `topicExactMatch`
- `policyTitleMatch`
- `sourceQuality.policyTitleMatch` when available

This is diagnostic-only and does not change fixture schema expectations or endpoint behavior.

## Static Contract

`scripts/check-rag-contract.mjs` now fails if `RAGSearchService.ts` loses these RAG-3O generic policy guard markers:

- `isGenericPolicyIntent`
- `hasExactTopicMatch`
- `hasPolicyGradeTitle`
- `isGenericTopicRescueCandidate`
- `findWeakestGenericPolicyReplacementIndex`
- `generic_topic_rescue`
- `generic_vector_seed_penalty`
- `topic_exact_match`
- `policy_title_match`
- `genericMetaSeedPenalty`

## Verification

Run from `D:\Projects\AdMate\admate-compass`:

```powershell
npm run type-check
npm run check:rag-contract
npm run check:compass-evidence-contract
npm run check:rag-source-quality:fixtures
npm run evaluate:rag-fixtures -- --diagnostics
npm run verify:harness
npm run build
git diff --check
```

## Residual Risk

This is a narrow guard/diagnostic pass. It does not prove live corpus quality, production endpoint behavior, or ranking performance against unfixtureed queries. The remaining risk is that future ranking changes preserve marker strings while weakening behavior; fixture diagnostics and source review should still accompany meaningful ranking edits.
