# RAG-2H Fixture Suite Refactor

Date: 2026-05-05

Scope: refactor the Compass RAG evaluation fixture suite and harness only. No RAG retrieval logic, API response logic, DB schema, imported data, embeddings, production env, or Ollama endpoint work was changed.

## Fixture Categories

Each fixture now has a `category`:

| Category | Meaning |
| --- | --- |
| `vendor-specific` | The query explicitly names a platform/vendor and source evidence should align with it. |
| `generic-policy` | The query asks a general advertising policy question and should accept any credible policy source. |
| `out-of-scope` | The query is intentionally outside advertising policy and should return `noDataFound=true`. |

Current split:

| Category | Fixtures |
| --- | ---: |
| `vendor-specific` | 10 |
| `generic-policy` | 8 |
| `out-of-scope` | 2 |

## Ambiguity Cleanup

The five ambiguous Kakao fixtures from RAG-2G are now classified as `generic-policy` and use `expectedVendor=ANY`:

- `kakao-false-exaggerated`
- `kakao-price-discount`
- `kakao-event-material`
- `kakao-hate-discrimination`
- `kakao-user-deception`

Their questions do not explicitly mention Kakao, so forcing Kakao was measuring an unstated routing rule rather than retrieval quality.

Explicit Kakao, Naver, Google, Meta, Facebook, and Instagram fixtures remain vendor-specific.

## Assertion Split

The harness now separates:

- `sourceMustContain` / `sourceMustNotContain`
- `generationMustContain` / `generationMustNotContain`

Source assertions inspect final source evidence only. Generation assertions inspect answer text only and are skipped when generation is not available or when `--source-only` is used.

This keeps production MVP evaluation focused on verified retrieval while Ollama generation remains a later backlog.

## Diagnostic Output

`npm run evaluate:rag-fixtures -- --run --diagnostics` now includes:

- `category`
- `assertionTypes`
- `sourceFailures`
- `generationFailures`
- existing query intent and source diagnostics

Source-only pass/fail is therefore visible without mixing answer text failures into retrieval failures.

## Local Validation Snapshot

After the refactor, the local endpoint diagnostic run reports:

| Metric | Value |
| --- | ---: |
| Source-only pass | 14 |
| Source-only fail | 6 |
| Generation assertion fail | 4 |
| `vendor-specific` fixtures | 10 |
| `generic-policy` fixtures | 8 |
| `out-of-scope` fixtures | 2 |

The remaining source-only failures are now clearer retrieval/corpus issues rather than generic query ambiguity.

## Remaining Real Retrieval Issues

These are still valid retrieval/corpus issues, not fixture ambiguity:

- Explicit Kakao review question can still surface Meta evidence.
- Explicit Kakao service/logo question can return no evidence.
- Explicit Google Ads policy question can return no evidence.
- Some source vendor inference remains noisy for broad `document_chunks`.

## Next Recommended Gate

Gate RAG-2I should use the cleaner fixture suite to decide whether to:

1. Improve source vendor inference for `document_chunks`.
2. Add stricter explicit-vendor source family checks.
3. Plan multi-vendor `ollama_document_chunks` regeneration.
4. Add canonical source inventory for Kakao and Google policy pages.
