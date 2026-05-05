# RAG-2E Failure Analysis / Corpus Coverage Plan

Date: 2026-05-05

Scope: analyze the 11 failing fixtures from the RAG-2D local endpoint baseline. No RAG logic, DB schema, embeddings, imports, production env, or data were changed.

## Executive Summary

RAG-2D improved the local fixture pass rate from 6/20 to 9/20 and fixed both out-of-scope fixtures. The remaining failures are mostly not API contract issues. They split into three root causes:

1. Vector corpus coverage is too narrow: `ollama_document_chunks` contains only Meta/Facebook/Instagram seed rows, so vector candidates still bias toward Meta.
2. Keyword corpus is broad but noisy: `document_chunks` contains Kakao, Naver, Google, and policy terms, but many chunks include navigation, Next.js payload text, generic tips, or weak titles.
3. Fixture expectations are partly stricter than the current corpus shape: several Kakao fixtures expect `집행기준/준수사항/카카오`, but the highest available Kakao chunks are under titles such as `카카오모먼트 심사 가이드`, `운영정책`, `광고등록기준`, or generic page titles.

## RAG-2D Result Summary

Local endpoint result after RAG-2D:

| Metric | Value |
| --- | ---: |
| Pass | 9 |
| Fail | 11 |
| Total | 20 |
| Final source methods | hybrid 18, keyword 16, vector 14 |
| Final source corpora | `ollama_document_chunks` 32, `document_chunks` 16 |
| Out-of-scope weather | pass, `noDataFound=true` |
| Out-of-scope recipe | pass, `noDataFound=true` |

RAG-2C baseline was 6/20 pass with final sources effectively dominated by `ollama_document_chunks`. RAG-2D moved some final evidence into `document_chunks`, but not enough for Kakao/Google topic precision.

## Failed Fixture Matrix

| Fixture | Vendor intent | Final corpora | Final methods | Observed titles | Failure class |
| --- | --- | --- | --- | --- | --- |
| `kakao-review-standards` | KAKAO | `ollama_document_chunks` | hybrid | `메타 광고 정책 2024` | expected title mismatch, vendor mismatch, scoring |
| `kakao-youth-harmful-content` | KAKAO | mixed | hybrid, keyword | `메타 광고 정책 2024`, `운영정책`, `광고등록기준` | expected title mismatch, mixed vendor, partial coverage |
| `kakao-false-exaggerated` | KAKAO inferred weakly by fixture, no explicit vendor in query | mixed | hybrid, keyword | `메타 광고 정책 2024`, `이용약관` | missing `오인`, expected title mismatch, intent ambiguity |
| `kakao-price-discount` | KAKAO inferred by fixture, no explicit vendor in query | `ollama_document_chunks` | vector | `인스타그램 광고 사양`, `페이스북 광고 정책`, `메타 광고 정책 2024` | expected title mismatch, method mismatch, vendor ambiguity |
| `kakao-event-material` | KAKAO inferred by fixture, no explicit vendor in query | `ollama_document_chunks` | hybrid, vector | Meta/Instagram/Facebook | missing `경품`, `참여`, expected title mismatch |
| `kakao-hate-discrimination` | KAKAO inferred by fixture, no explicit vendor in query | `document_chunks` | keyword | Naver ad tips titles | missing `혐오`, `차별`, expected title mismatch, noisy keyword corpus |
| `kakao-user-deception` | KAKAO inferred by fixture, no explicit vendor in query | `ollama_document_chunks` | hybrid, vector | Meta/Instagram/Facebook | missing `기만`, expected title mismatch |
| `kakao-kakao-service-protection` | KAKAO | `ollama_document_chunks` | vector | `메타 광고 정책 2024` | expected title mismatch, method mismatch, vendor mismatch |
| `meta-video-ad-specs` | META | `ollama_document_chunks` | hybrid, vector | Instagram/Facebook/Meta | missing `240`; source is right family but generated answer/source blob did not expose required term |
| `google-ads-policy` | GOOGLE | `ollama_document_chunks` | vector | `메타 광고 정책 2024` | expected title mismatch, method mismatch, vendor mismatch |
| `gambling-policy` | ANY | `document_chunks` | keyword | Naver tips / `클린센터` | expected title mismatch, weak policy-title coverage |

## Corpus Coverage Findings

Read-only local CSV scan:

| Corpus | Coverage finding |
| --- | --- |
| `ollama_document_chunks` | Logical source export has only 6 sample rows, all Meta/Facebook/Instagram-oriented. It has no Kakao, Naver, or Google policy coverage. |
| `document_chunks` | 38,973 rows include substantial Kakao, Naver, Google, Meta, and policy terms. This is the only currently imported corpus with broad vendor coverage. |

Term presence in `document_chunks` confirms coverage exists:

| Term group | Evidence |
| --- | --- |
| Kakao | `카카오`, `kakao`, `카카오모먼트`, `카카오톡`, `비즈보드` appear in rows. |
| Naver | `네이버`, `NAVER`, `쇼핑검색`, `파워링크`, `브랜드검색` appear in rows. |
| Google | `Google`, `Google Ads`, `YouTube` appear in rows, but many samples are operational/help pages rather than policy pages. |
| Policy topics | `오인`, `경품`, `혐오`, `차별`, `도박`, `청소년`, `유해`, `가격`, `할인`, `로고` appear in rows. |

Important nuance: broad term presence does not mean clean retrieval readiness. Some `document_chunks` rows contain noisy navigation text, embedded app payloads, PDF placeholder text, or generic ad operation tips. Metadata title quality varies by source.

## Why Meta Sources Still Appear

The main reason is corpus asymmetry:

- Vector search is limited to `compass.ollama_document_chunks`.
- `ollama_document_chunks` only has Meta seed data.
- Strong vector scores from the Meta seed can survive when the keyword channel has noisy, low-title-quality candidates.
- Some fixture questions do not explicitly mention Kakao even though the fixture expects Kakao. For example, price, event, false/exaggerated, hate, and deception questions are generic policy questions. Without explicit vendor intent, the vendor mismatch gate cannot confidently reject Meta.

RAG-2D reduced this problem but did not eliminate it because rejecting all vector candidates for generic policy topics would harm current Meta fixtures and generic ANY-policy fixtures.

## Root Cause Classification

| Category | Fixtures | Notes |
| --- | --- | --- |
| Scoring / ranking | `kakao-review-standards`, `kakao-price-discount`, `kakao-kakao-service-protection`, `google-ads-policy` | Explicit vendor exists but Meta vector still survives. Needs stronger vendor mismatch rejection or lower vector trust when `ollama_document_chunks` lacks target vendor. |
| Intent ambiguity | `kakao-false-exaggerated`, `kakao-price-discount`, `kakao-event-material`, `kakao-hate-discrimination`, `kakao-user-deception` | Fixture expects Kakao, but query text does not always mention Kakao. Current code should not assume Kakao for all Korean generic policy questions. |
| Corpus coverage / metadata quality | `kakao-youth-harmful-content`, `kakao-hate-discrimination`, `gambling-policy` | Relevant terms exist in `document_chunks`, but noisy titles and generic content reduce ranking and expected title match. |
| Fixture expectation mismatch | Several Kakao fixtures | Current corpus has relevant Kakao chunks under titles other than `집행기준 및 준수사항`; expected title hints may need to include `카카오모먼트 심사 가이드`, `운영정책`, `광고등록기준` if those are accepted sources. |
| Answer/text exposure | `meta-video-ad-specs` | Source family is correct, but the required term `240` was not exposed in response/source text consistently. This is less about vendor and more about excerpt/context selection. |

## Data Quality Issues

1. `ollama_document_chunks` is not representative. It is too small and Meta-only.
2. `document_chunks` title metadata is inconsistent. Some titles are useful; others are generic, page-not-found, app payload, or operational tips.
3. Some Google corpus rows are operational Google Ads help pages, not necessarily policy pages.
4. Kakao policy coverage appears present, but some rows are split across chunks and titles are not normalized to the fixture's expected source name.
5. Source URL quality is not the top blocker for RAG-2E, but missing/weak URL/title metadata makes sourceQuality less discriminative.

## Fixture Expectation Review

Some fixture expectations are valid as product goals but do not fully match current corpus shape:

- Kakao fixtures expect `집행기준`, `준수사항`, or `카카오`. This is right for the ideal corpus, but current top available Kakao chunks include `카카오모먼트 심사 가이드`, `운영정책`, and `광고등록기준`.
- Generic policy questions are assigned `expectedVendor=KAKAO` even when the question lacks Kakao terms. For deterministic retrieval, either the fixture should include a vendor term or the evaluator should mark these as `ANY` until a default Korean policy routing rule is explicitly accepted.
- Google fixture expects Google policy, but current Google coverage looks mixed between help docs and operational docs. Before tightening scoring further, source inventory should identify clean Google policy documents.

## RAG-2F Priority Plan

Recommended next implementation priority:

1. Add evaluator diagnostics, not retrieval changes first.
   - Save per-fixture source ids, titles, corpora, retrievalMethod, hybridScore, lexicalOverlap, vendorMatch, vendorMismatch, and sourceQuality warnings.
   - This makes future tuning less guessy.

2. Strengthen explicit vendor mismatch handling.
   - If query explicitly mentions Kakao, Naver, or Google, reject `ollama_document_chunks` candidates whose detected vendor is Meta-only unless there is a very strong lexical match and no target-vendor candidate exists.
   - Keep this rule only for explicit vendor intent to avoid breaking generic policy questions.

3. Add target-vendor rescue ranking for `document_chunks`.
   - For explicit Kakao/Naver/Google intent, if any `document_chunks` candidate has vendor match plus topic lexical overlap, reserve at least one top source slot for it.
   - This is safer than globally boosting all `document_chunks`.

4. Add title/source normalization map.
   - Normalize titles like `카카오모먼트 심사 가이드`, `운영정책`, `광고등록기준` into a clearer display/source family.
   - Do this in response/source metadata layer first, not DB mutation.

5. Review fixture expectations.
   - Decide whether generic Korean policy questions should default to Kakao.
   - If yes, add an explicit product rule and document it.
   - If no, change those fixtures to `ANY` or add `카카오` to the fixture question.

6. Plan a later `ollama_document_chunks` regeneration.
   - Not for RAG-2F unless explicitly approved.
   - Ideal direction: generate compact vector-ready chunks for Kakao, Naver, Google, and Meta policy pages, linked back to `documents`.

## Recommended RAG-2F Gate

Gate RAG-2F should implement explicit-vendor precision without broad data changes:

- Add fixture diagnostic output to `scripts/evaluate-rag-fixtures.mjs`.
- Add explicit vendor strict mode in `RAGSearchService`.
- Add target-vendor `document_chunks` rescue slot.
- Add source title normalization in returned source metadata.
- Do not change DB schema, embeddings, imports, or production env.

Success criteria:

- Kakao/Google explicit vendor fixtures should no longer return Meta-only final sources.
- Generic ANY-policy fixtures should not regress.
- Out-of-scope weather/recipe remains `noDataFound=true`.
- `sourcesCount` may decrease if irrelevant sources are removed.

