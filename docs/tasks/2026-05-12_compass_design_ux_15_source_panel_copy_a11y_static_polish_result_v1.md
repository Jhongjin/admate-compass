# Compass Design UX 15 Source Panel Copy A11y Static Polish Result v1

Date: 2026-05-12
Status: implemented / local static polish
Repo: admate-compass

## Purpose

Apply a small non-authenticated Compass design/UX polish pass for source-panel
copy and icon-only source-card controls.

This gate intentionally stayed away from authenticated production QA and did
not submit prompts, call production APIs, inspect sessions, mutate data, or
exercise RAG/database/import/reembedding/crawler paths.

## Changes

Changed files:

- `src/components/chat/SourceStatePanel.tsx`
- `src/components/chat/RelatedResources.tsx`
- `src/app/page.tsx`

Implementation summary:

- Replaced the source-panel no-data sentence with Korean product-facing copy.
- Replaced the expanded related-resource trust text `Compass verified source`
  with Korean copy.
- Added `aria-label` text to icon-only source-card open/download and expand
  controls in `RelatedResources`.
- Softened public landing copy from explicit admin-area wording to a broader
  operation-guidance tone.

## Boundaries

Not performed:

- authenticated QA
- production/API calls
- prompt submission
- DB/schema/import/reembedding/crawler work
- env, secret, token, cookie, session, signed URL, or provider payload
  inspection
- package or lockfile changes
- stage, commit, or push

## Verification

Completed local verification:

```text
npm run check:compass-chat-ui-state-contract: pass
npm run verify:harness: pass
npm run type-check: pass
npm run build: pass
git diff --check -- src/components/chat/SourceStatePanel.tsx src/components/chat/RelatedResources.tsx src/app/page.tsx docs/tasks/2026-05-12_compass_design_ux_15_source_panel_copy_a11y_static_polish_result_v1.md: pass
git diff --cached --name-only: no staged files
```
