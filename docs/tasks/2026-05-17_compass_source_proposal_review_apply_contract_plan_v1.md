# Compass source proposal review and apply contract plan v1

Date: 2026-05-17
Repo: admate-compass
Status: docs and guard only

## Decision

Compass has a durable source proposal queue, but it does not yet have an
approved review, approval, rejection, apply, index, or corpus promotion path.

Current queue rows are intentionally proposal-only:

- `dry_run=true`
- `mutation_enabled=false`
- `would_index=false`
- `would_promote=false`
- `review_status` is limited to `pending`, `rejected`, and `expired`

The existing schema can support read-only inventory and non-production dry-run
queue persistence. It must not be treated as an approved production apply
surface.

## Contract Before Any Implementation

Before any approve, reject, or apply route is implemented, Compass needs a
separate contract that defines:

- authenticated admin or internal worker authority
- actor id, actor role, and account boundary
- required review reason
- immutable review audit trail
- idempotency key and apply lock
- source proposal row snapshot before apply
- sanitized extraction preview snapshot
- apply target type: source registry update, extraction candidate, corpus
  promotion, or rejection only
- rollback or expiry behavior
- no-secret-output logging

## Required Gates

Safe order:

1. rejection-only contract, with actor and reason, no corpus mutation
2. approval contract, still no corpus mutation
3. extraction apply contract, writes only extraction artifacts or source
   registry state
4. chunking and embedding apply contract, after WebPageExtractionService and
   source-quality checks are stable
5. production smoke with explicit human approval

Do not skip from proposal queue directly to corpus promotion.

## Forbidden Until Contract Exists

Do not add:

- approve or reject buttons on `/admin/source-ops`
- `POST` apply controls from the source ops page
- production queue writes
- Vercel Cron activation for proposal writes
- automatic crawl, chunk, embed, index, or promote behavior
- direct writes to `documents`, `document_chunks`, `ollama_document_chunks`, or
  embeddings from source proposal routes
- LLM-based proposal approval without deterministic evidence and audit logging
- secret, token, cookie, session, credential, or provider response readback

## Current Safe State

The current UI can show:

- source watch coverage
- backend-agent next action
- proposal queue readback
- pending candidates
- deterministic relevance review

The current system can write proposal queue rows only in local/staging dry-run
mode after explicit worker enablement and authentication. Production persistence remains blocked.
