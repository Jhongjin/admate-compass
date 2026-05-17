# Compass source ops agent schedule contract result v1

Date: 2026-05-17
Repo: admate-compass
Status: implemented

## Scope

Expanded the read-only Compass source operations surface so operators can see
how the backend agent would maintain official policy sources without exposing a
manual crawl/upload/apply workflow.

This is an operator-visible mode only. It does not add Vercel Cron, does not enable production queue writes, and does not create a corpus promotion path.

## Added Contract Fields

Each source plan item now includes:

- `agentAction`: the next backend-agent action category.
- `nextReviewAt`: the next scheduled review timestamp when existing corpus
  coverage provides a baseline.
- `reviewUrgency`: the operator-facing status for whether the source is normal,
  should enter a proposal queue, or needs extraction review.

The action categories are intentionally proposal-oriented:

- `watch`
- `refresh_candidate`
- `review_extraction`
- `queue_exact_url`
- `queue_domain_discovery`

## UI Behavior

`/admin/source-ops` now renders an `AI 수집 스케줄` block on every source card.
The block shows:

- next backend-agent action
- next review due date or immediate review state
- source review cadence
- urgency badge

The page remains read-only. It still does not call POST routes, enable
`fetch=true`, crawl, chunk, index, embed, promote, approve, reject, or mutate
source proposal rows.

## Safety Boundary

This pass keeps the existing operating decision:

- backend agent proposes source refresh candidates
- operators inspect state and queue inventory
- production corpus promotion remains a separate approval/apply gate
- manual upload/crawl remains fallback maintenance, not the primary source
  upkeep model

No SQL, Supabase writes, production HTTP calls, Vercel Cron activation, n8n
changes, embeddings, LLM calls, or secret/env/cookie/session reads were added.
