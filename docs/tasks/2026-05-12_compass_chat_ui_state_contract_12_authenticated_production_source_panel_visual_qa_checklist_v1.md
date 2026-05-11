# Compass Chat UI State Contract 12 Authenticated Production Source Panel Visual QA Checklist v1

Date: 2026-05-12
Status: docs-only next-step checklist
Owner scope: `docs/tasks` only
Repo: `D:\Projects\AdMate\admate-compass`
Follows closure: `c4642a723 docs: close Compass source panel fixture QA`

## Purpose

Prepare the next human-gated production visual QA step for the authenticated
Compass source panel after the local/offline fixture renderer track closed.

This document does not approve production prompt, API, RAG, database, crawler,
reembedding, fixture, env, or code work. Those remain out of scope unless a
human explicitly approves a separate plan.

## Hard Gate

Do not begin authenticated production QA until a human confirms all of these:

- production deployment target and expected commit are identified
- test account/session is approved for visual inspection
- browser scope is limited to authenticated UI viewing
- no prompt submission is approved by default
- no direct `/api/chat-ollama` request is approved by default
- no RAG, DB, crawler, reembedding, env, or fixture work is approved
- screenshot handling rules are clear, including redaction needs

If any item is missing, record the QA as blocked.

## Allowed By Default

- Open the approved production URL in the approved authenticated browser
  session.
- Navigate only to the visible chat/source panel UI.
- Inspect source-panel layout, wrapping, labels, buttons, empty states, and
  mobile responsiveness.
- Capture screenshots only if the human-approved session rules allow it.
- Record visible UI observations and blockers.

## Not Allowed Without Separate Approval

- Submit or replay production prompts.
- Call `/api/chat-ollama` directly or indirectly for test generation.
- Change prompts, prompt templates, API routes, RAG logic, or
  `RAGSearchService`.
- Read or write production DB data, schema, migrations, imports, crawler state,
  embeddings, or reembedding jobs.
- Read, print, edit, or rotate env files, secrets, tokens, cookies, local
  storage, session storage, provider payloads, or signed URLs.
- Edit `src/`, `scripts/`, `docs/rag/`, fixtures, package files, env files, or
  deployment settings.

## Visual Checklist

Use only already-visible authenticated UI states.

- Source panel appears in the expected desktop position and does not overlap
  chat content.
- Mobile source panel remains in the content flow and does not trap the
  composer.
- Long Korean source titles wrap without horizontal overflow.
- Source count, source cards, excerpts, and open controls remain readable.
- Empty/no-data/error/limited states do not imply unsupported evidence.
- Internal/provider/security text is not visible to the user.
- Screenshots or notes avoid secrets, personal data, and raw provider payloads.

## Stop Conditions

Stop and mark blocked if the reviewer needs to:

- submit a prompt to create a state
- inspect network payloads or storage
- call an API route
- check RAG/DB internals
- alter production data, env, fixtures, or deployment config
- troubleshoot by editing code

## Minimal Record To Produce

After approved visual inspection, record:

- production URL and deployment commit, if human-confirmed
- reviewer/session type, without credentials
- viewport(s) reviewed
- observed source-panel states
- pass/block/fail per state
- redacted screenshot references, if allowed
- explicit confirmation that no prompt/API/RAG/DB/env/fixture/code work was
  performed

## Verification For This Docs Task

Requested local verification:

```powershell
git diff --check
npm run verify:harness
```

No commit or push is authorized by this checklist.
