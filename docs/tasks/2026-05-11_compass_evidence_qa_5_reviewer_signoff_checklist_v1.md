# Compass Evidence QA 5 Reviewer Signoff Checklist v1

Date: 2026-05-11
Status: reviewer signoff checklist
Fixture/checker commit: `8c0878cd0 test: add Compass evidence QA fixtures`
Recap commit: `a5caf4658 docs: recap Compass evidence QA fixtures`
Scope: docs-only checklist; no fixture, checker, package, script, or source edits

## Purpose

Use this checklist to review and sign off the offline Compass Evidence QA
fixture/checker contract before treating it as an adopted harness gate or using
it as a basis for UI/RAG behavior expansion.

## Files Under Review

Reviewer scope from commit `8c0878cd0`:

- `docs/rag/compass-evidence-qa-fixtures.json`
- `scripts/check-compass-evidence-qa-fixtures.mjs`
- `package.json` harness wiring for `check:compass-evidence-qa` and
  `verify:harness`

This checklist does not authorize edits to those files.

## Offline Fixture Review Items

### Fixture Set Shape

Pass:

- Fixture file is valid JSON.
- Top-level value is an array.
- There are at least 8 fixture objects.
- All fixture `id` values are non-empty and unique.
- Every fixture has `synthetic: true`.
- Every fixture has non-empty `requestLabel` and `answerSummary`.

Fail:

- Invalid JSON, non-array root, duplicate IDs, missing labels, or any fixture
  that is not explicitly synthetic.

### Evidence State Coverage

Pass:

- Required states are all represented:
  - `source-found`
  - `noData`
  - `generation-limited`
- Current committed distribution is acceptable for review:
  - `source-found`: 4
  - `noData`: 3
  - `generation-limited`: 2

Fail:

- Any required state is absent.
- Fewer than 3 `source-found` fixtures.
- Fewer than 3 `noData` fixtures.
- Fewer than 2 `generation-limited` fixtures.

### Source-Found Cases

Pass:

- `sourcePanel` includes non-empty:
  - `sourceLabel`
  - `sourceCategory`
  - `freshnessLabel`
  - `reviewStatus`
  - `evidenceRecordLabel`
  - `verifiedFacts`
  - `generatedInterpretation`
- `reviewStatus` is `accepted`.
- `sourceCategory` is allowlisted.
- Expected user-visible labels appear in `expectedDisplayText`.

Fail:

- A `source-found` fixture has missing source shell fields.
- `reviewStatus` is anything other than `accepted`.
- Source category is outside the checker allowlist.
- Expected display text cannot be found in the fixture display surface.

### No-Data Cases

Pass:

- `sourcePanel` includes non-empty:
  - `noDataReason`
  - `checkedScope`
  - `reviewStatus`
- `reviewStatus` is `unavailable` or `rejected`.
- No source shell fields such as `sourceLabel` or `evidenceRecordLabel` are
  present.
- Fixture does not imply that unsupported, future, fictional, or rejected
  evidence is safe or accepted.

Fail:

- A `noData` fixture includes a source shell.
- `reviewStatus` is not `unavailable` or `rejected`.
- Display text implies supported/accepted evidence when the state is `noData`.

### Generation-Limited Cases

Pass:

- `sourcePanel` includes non-empty:
  - `sourceLabel`
  - `sourceCategory`
  - `freshnessLabel`
  - `reviewStatus`
  - `evidenceRecordLabel`
  - `limitationReason`
  - `partialSourceSummary`
  - `verifiedFacts`
  - `generatedInterpretation`
- `reviewStatus` is one of:
  - `limited`
  - `expired`
  - `unreviewed`
- At least 2 generation-limited fixtures preserve available source labels.
- The answer remains limited and does not upgrade to accepted/supported.

Fail:

- Limitation reason or partial source summary is missing.
- Review status is outside the limited-state set.
- Available source context is dropped.
- Text implies the evidence is fully supported, accepted, or verified by
  Compass beyond the limited state.

### Redaction Case

Pass:

- At least 1 fixture includes `redactionInput`.
- Every redaction input field name and value appears in
  `expectedExcludedText`.
- Redacted field names and raw values do not appear in display text.
- Current committed redaction case covers synthetic account, campaign, trace,
  and retrieval identifiers.

Fail:

- No redaction fixture exists.
- Raw identifier field names or values are visible in display text.
- `expectedExcludedText` omits a redaction field name or value.

### Display and Exclusion Contract

Pass:

- Every fixture includes non-empty `expectedDisplayText`.
- Every fixture includes non-empty `expectedExcludedText`.
- Each expected display fragment is present in the collected display surface.
- Each excluded fragment is absent from the collected display surface.
- Display text avoids guarded patterns for raw payload/source/provider/OCR,
  internal IDs, prompts, models, tokens, cookies, credentials, secrets, signed
  URLs, API keys, private keys, authorization/bearer/password text, retrieval
  internals, vector scores, hybrid scores, source counts, `schema=compass`,
  `ollama_document_chunks`, `RAGSearchService`, and private dashboard labels.

Fail:

- Required display text is absent.
- Excluded text appears in the display surface.
- Any guarded implementation, credential, raw source, private dashboard, or
  internal retrieval pattern is user-visible.

### Harness Wiring

Pass:

- `check:compass-evidence-qa` runs
  `node scripts/check-compass-evidence-qa-fixtures.mjs`.
- `verify:harness` includes
  `node scripts/check-compass-evidence-qa-fixtures.mjs`.
- Checker output reports:
  - `mode: "compass-evidence-qa-fixture-contract"`
  - `ragSearchExecuted: false`
  - `productionApiCalled: false`

Fail:

- Evidence QA checker is omitted from the offline harness.
- Checker output suggests live RAG, production API, DB, crawler, import,
  embedding, or reembedding execution.

## Blocked Before UI/RAG Behavior Expansion

The following remain blocked until a separate explicit approval gate:

- UI assertions or authenticated browser QA.
- `/api/chat-ollama` behavior tests or route changes.
- `RAGSearchService` changes.
- Live retrieval checks.
- Production smoke coverage.
- DB reads or writes.
- Crawler, import, embedding, or reembedding work.
- Env/secret reads or writes.
- Fixture contract expansion that changes pass/fail behavior.
- Package/script/src edits beyond the already committed offline checker path.

Recommended gate name:

```text
Compass-Evidence-QA-UI-or-RAG-Behavior-Expansion-Approval
```

## Reviewer Signoff Decision

Sign off only if all pass conditions above are satisfied and no blocked
expansion work is required for this gate.

Decision options:

- `Approved: offline fixture/checker contract accepted`
- `Approved with follow-up: offline contract accepted, non-blocking doc or
  fixture clarity items tracked separately`
- `Rejected: contract must be revised before harness adoption`
- `Blocked: needs separate UI/RAG behavior expansion approval`

Reviewer notes to capture:

```text
reviewer:
decision:
required follow-ups:
blocked expansion requested:
```

## Verification Commands

For this docs-only checklist:

```powershell
git diff --check -- docs/tasks/2026-05-11_compass_evidence_qa_5_reviewer_signoff_checklist_v1.md
npm run verify:harness
```

Expected offline harness signal:

- `check-rag-contract` passes.
- `check-rag-source-quality` sample passes.
- RAG fixtures evaluate locally.
- noData boundary fixture contract passes.
- Compass Evidence QA fixture contract passes.
- Admin debug surface check passes.
- Evidence QA checker reports `ragSearchExecuted: false`.
- Evidence QA checker reports `productionApiCalled: false`.

## No-Touch Confirmation

This checklist task must not perform:

- Package edits.
- Script edits.
- Fixture edits.
- Source edits.
- Production API calls.
- DB reads or writes.
- Crawler, import, embedding, or reembedding execution.
- Env/secret reads or writes.
- Commit or push.

Only this docs file is in scope:

```text
docs/tasks/2026-05-11_compass_evidence_qa_5_reviewer_signoff_checklist_v1.md
```
