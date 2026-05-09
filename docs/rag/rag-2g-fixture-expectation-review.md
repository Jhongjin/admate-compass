# RAG-2G Fixture Expectation Review

Date: 2026-05-05

Scope: review whether the current evaluation fixtures match the current Compass corpus and query intent after RAG-2F. No RAG logic, DB schema, embeddings, data, production env, or fixture JSON were changed.

## Current Result

Latest local endpoint diagnostic run:

| Metric | Value |
| --- | ---: |
| Total fixtures | 20 |
| Pass | 10 |
| Fail | 10 |
| Explicit non-Meta fixtures with Meta final source | 1 |
| Final `document_chunks` sources | 16 |
| Out-of-scope weather/recipe | pass, `noDataFound=true` |

RAG-2F reduced Meta seed leakage, but several failures remain because fixture expectations are stricter than the current corpus shape or because the question does not explicitly express the vendor expected by the fixture.

## Failed Fixture Review

| Fixture | Query explicit vendor | Expected vendor | Actual top source vendors/corpus | Expectation review | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `kakao-review-standards` | KAKAO | KAKAO | META / `ollama_document_chunks` | Valid fixture. The query explicitly asks Kakao, so Meta sources are wrong even if lexical overlap is high. | Keep expectedVendor KAKAO. Treat as retrieval/scoring issue. |
| `kakao-youth-harmful-content` | KAKAO | KAKAO | UNKNOWN / `document_chunks` | Mostly valid. The query explicitly asks Kakao and terms are present, but current source titles are `운영정책`, `광고등록기준`, not necessarily `집행기준/준수사항`. | Keep KAKAO, expand expected title hints to include accepted Kakao corpus titles after source inventory. |
| `kakao-false-exaggerated` | none | KAKAO | META + NAVER/UNKNOWN mixed | Ambiguous. The question asks a general policy concept and does not mention Kakao. Expecting Kakao is a product preference, not query intent. | Either rewrite query with `카카오` or change expectedVendor to ANY. |
| `kakao-price-discount` | none | KAKAO | META / `ollama_document_chunks` | Ambiguous. The topic is generic price/discount policy. No explicit Kakao term. | Either rewrite query with `카카오` or change expectedVendor to ANY. |
| `kakao-event-material` | none | KAKAO | META / `ollama_document_chunks` | Ambiguous. The topic is generic event ad material policy. No explicit Kakao term. | Either rewrite query with `카카오` or change expectedVendor to ANY. |
| `kakao-hate-discrimination` | none | KAKAO | `document_chunks`, noisy Naver-titled sources | Ambiguous plus metadata/noise issue. The question is a general policy question and does not mention Kakao. It should not force Kakao unless Compass has a documented Korean-policy default. | Change expectedVendor to ANY, or rewrite with `카카오`. Also review sourceVendor inference because some Naver-titled chunks are diagnosed as META. |
| `kakao-user-deception` | none | KAKAO | META / `ollama_document_chunks` | Ambiguous. The topic is generic deception/misleading expression. No explicit Kakao term. | Either rewrite query with `카카오` or change expectedVendor to ANY. |
| `kakao-kakao-service-protection` | KAKAO | KAKAO | no final sources | Valid fixture. Query explicitly asks Kakao service/logo/design. `noDataFound=true` means corpus/ranking cannot yet surface suitable evidence. | Keep expectedVendor KAKAO. Treat as corpus/ranking coverage issue. |
| `google-ads-policy` | GOOGLE | GOOGLE | no final sources | Valid fixture. Query explicitly asks Google Ads. Current corpus does not surface clean Google policy evidence. | Keep expectedVendor GOOGLE. Treat as corpus coverage/source inventory issue. |
| `gambling-policy` | none | ANY | `document_chunks`, Naver-titled sources | Valid as generic policy, but expected title hints are too narrow for current corpus. It passes source existence and terms but fails title hints. | Keep expectedVendor ANY. Relax/expand expectedSourceTitle or separate title-quality assertion. |

## Ambiguity Fixtures

These fixtures have a concrete expected vendor but the question does not explicitly mention that vendor:

| Fixture | Current expectedVendor | Recommended action |
| --- | --- | --- |
| `kakao-false-exaggerated` | KAKAO | Change to ANY for source-only evaluation, or rewrite question to include Kakao. |
| `kakao-price-discount` | KAKAO | Change to ANY, or rewrite question to include Kakao. |
| `kakao-event-material` | KAKAO | Change to ANY, or rewrite question to include Kakao. |
| `kakao-hate-discrimination` | KAKAO | Change to ANY, or rewrite question to include Kakao. |
| `kakao-user-deception` | KAKAO | Change to ANY, or rewrite question to include Kakao. |

Recommended default: for RAG-2 quality measurement, do not assume Kakao from generic Korean policy questions. Use `expectedVendor=ANY` unless the query explicitly names Kakao or the product has an approved rule that Korean generic policy questions route to Kakao first.

## Fixture Update Candidates

### Keep Concrete Vendor

Keep these because the query explicitly names the vendor:

- `kakao-review-standards`
- `kakao-youth-harmful-content`
- `kakao-kakao-service-protection`
- `google-ads-policy`
- existing Meta/Facebook/Instagram fixtures
- `naver-shopping-ad`

### Change Expected Vendor To ANY

Recommended candidates:

- `kakao-false-exaggerated`
- `kakao-price-discount`
- `kakao-event-material`
- `kakao-hate-discrimination`
- `kakao-user-deception`

This would turn the evaluation from "must retrieve Kakao" into "must retrieve any credible policy source covering the topic." A later vendor-specific fixture can be added separately for each topic.

### Rewrite Query Instead Of Changing Vendor

If the product goal is specifically to test Kakao policy retrieval, rewrite the same fixtures:

- `카카오에서 허위 과장 광고는 어떤 경우 제한돼?`
- `카카오 광고 소재에 가격이나 할인율을 표시할 때 기준은?`
- `카카오 이벤트 광고 소재에는 어떤 정보를 넣어야 하나요?`
- `카카오 광고에서 혐오표현이나 차별 표현이 들어가면 어떻게 되나요?`
- `카카오에서 이용자를 오인하게 하는 표현은 광고 집행이 가능한가요?`

This is stricter and better for vendor routing tests, but it should be a separate fixture group from generic policy tests.

## Must-Contain Review

Current `mustContain` rules mix source retrieval quality with generated answer quality.

| Fixture | Current issue | Recommendation |
| --- | --- | --- |
| `kakao-false-exaggerated` | Requires `오인`; source may discuss 허위/과장 without exposing the exact word in selected excerpt. | Keep only in generation evaluation, or allow source-only match on related topic terms. |
| `kakao-event-material` | Requires `경품`, `참여`; valid for Kakao-specific source, but generic event policy can surface broader event guidance. | Keep for Kakao-specific rewritten fixture; relax for ANY fixture. |
| `kakao-user-deception` | Requires both `오인`, `기만`; current corpus may split these across chunks. | Source-only should require at least one core term plus topic title/source match; generation eval can require both. |
| `meta-video-ad-specs` | Requires `240`; answer/source excerpt exposure can vary even with correct Meta source. | Source-only should check correct source family and video/spec evidence; generation eval can require exact `240`. |
| `gambling-policy` | MustContain is valid; failure is mostly title hint. | Keep mustContain, relax expectedSourceTitle. |

## Expected Source Title Review

Several title hints assume ideal source names that are not always present in the current imported corpus.

Recommended approach:

1. For source-only evaluation, use broader accepted title families:
   - Kakao: `카카오`, `카카오모먼트`, `운영정책`, `광고등록기준`, `심사 가이드`, `집행기준`
   - Naver: `네이버`, `쇼핑검색`, `파워링크`, `브랜드검색`, `클린센터`
   - Google: `Google`, `구글`, `Google Ads`, `YouTube`
   - Generic policy: `정책`, `가이드`, `운영정책`, `집행기준`, `광고등록기준`, `클린센터`
2. Keep strict source-title checks for canonical-source readiness tests only.
3. Track title normalization separately from retrieval correctness.

## Source-Only vs Generation Evaluation

Production MVP currently treats Ollama generation as optional. Verified sources are the production-critical behavior. The evaluator should separate two modes:

| Evaluation mode | Purpose | Required checks |
| --- | --- | --- |
| Source-only retrieval | Verify Compass can find grounded evidence. | `noDataFound`, `sourcesCount`, `sourceVendor`, `retrievalMethod`, `corpus`, `sourceQuality`, title/source family, lexical/topic overlap. |
| Generation answer | Verify LLM uses evidence correctly. | answer `mustContain`, `mustNotContain`, exact numeric/spec terms, refusal wording, citation wording. |

Recommended implementation:

- Add fixture fields such as `evaluationMode` or `assertions.sourceOnly` / `assertions.generation`.
- In source-only mode, do not fail only because the generated fallback answer lacks `mustContain`.
- In generation mode, require answer text assertions only when the model is not `ollama-connection-failed` and generation is in scope.
- Keep current response contract validation in both modes.

## Current Retrieval Issues That Are Not Fixture Problems

These should remain RAG/corpus backlog items:

1. Explicit Kakao review query still returns Meta seed sources.
2. Explicit Kakao service/logo query returns no evidence.
3. Explicit Google Ads policy query returns no evidence.
4. `sourceVendor` inference still appears noisy for some Naver-titled `document_chunks`.
5. `ollama_document_chunks` remains Meta-only and is not representative of the full multi-vendor corpus.

## Recommended RAG-2H Fixture Update Plan

1. Split fixtures into two groups:
   - `vendor-specific`: query explicitly names vendor.
   - `generic-policy`: expectedVendor ANY unless a default routing rule is approved.
2. Update ambiguous Kakao fixtures either to ANY or rewrite their questions with Kakao.
3. Relax `expectedSourceTitle` for source-only evaluation to accepted source families.
4. Move exact answer text assertions into generation evaluation.
5. Keep explicit Kakao/Google failures as real retrieval/corpus backlog.

## Proposed Approval Wording

Approve Gate RAG-2H Fixture Suite Refactor:

- Do not modify RAG retrieval logic.
- Update `docs/rag/rag-2-evaluation-fixtures.json` to separate vendor-specific and generic-policy expectations.
- Change ambiguous generic Kakao fixtures to `expectedVendor=ANY` or rewrite them into explicit Kakao questions as approved.
- Split source-only assertions from generation assertions in `scripts/evaluate-rag-fixtures.mjs`.
- Preserve current response contract.
- Run `npm run evaluate:rag-fixtures`, `npm run evaluate:rag-fixtures -- --run --diagnostics`, and `npm run verify:harness`.
