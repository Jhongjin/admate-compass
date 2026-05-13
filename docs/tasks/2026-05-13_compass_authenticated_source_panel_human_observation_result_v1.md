# Compass Authenticated Source Panel Human Observation Result v1

Date: 2026-05-13 KST
Gate: Compass-Authenticated-QA-Source-Panel-Human-1
Status: pass
Scope: authenticated production UI manual observation using user-provided screenshots

## Purpose

Record the human-provided authenticated Compass `/chat-ollama` source panel
visual check after the automation session boundary was documented.

This result uses sanitized operator screenshots and manual observations only.
It does not inspect cookies, session values, tokens, browser storage, raw
provider payloads, source hashes, database rows, environment values, or secrets.

## Route And Session

Observed route:

```text
https://compass.admate.ai.kr/chat-ollama
```

Authenticated route result:

```text
login redirect loop: not observed
Compass chat shell: visible
source/evidence panel: visible
composer/input: visible
```

## Prompt Evidence

Visible prompt:

```text
메타 광고에 대해 알려줘
```

Observed answer state:

```text
generation-limited answer state: visible
source preservation: visible
source count class: 3 visible source cards
```

This matches the current Compass source-preservation contract: when answer
generation is limited, verified source cards remain visible to the user.

## Desktop Layout

Desktop screenshots showed:

- answer area inside the central viewport
- user prompt and Compass answer bubbles visible without overlap
- composer/input visible at the bottom of the chat area
- source/evidence panel visible on the right side
- source cards for Meta, Naver, and Kakao policy material visible
- long Korean source snippets clipped/wrapped inside card boundaries
- no obvious answer/source panel collision
- no obvious horizontal overflow from the app content

## Mobile Layout

Mobile screenshots showed:

- chat answer content stacked above source/evidence content
- source/evidence panel presented as in-flow compact content below the answer
- composer/input visible at the bottom of the viewport
- source cards remain inside the narrow viewport
- long Korean snippets wrap or truncate inside source cards
- no obvious horizontal overflow from the app content
- answer badges and feedback controls remain inside the viewport

## Internal Term Exposure

The supplied screenshots did not visibly expose these internal markers:

- `retrievalMethod`
- `sourceQuality`
- `hybridScore`
- `sourcesCount`
- `ollama_document_chunks`
- raw provider payload fragments
- source hash or embedding metadata

## Not Covered

This human observation did not re-test:

- noDataFound policy boundary behavior
- source card external open behavior
- raw `/api/chat-ollama` responses
- DB/schema/import/reembedding/crawler behavior
- authenticated browser automation attach

## No-Touch Confirmation

This gate did not perform:

- code changes
- direct production API calls by the agent
- RAGSearchService changes
- `/api/chat-ollama` changes
- DB/schema/import/reembedding/crawler changes
- SQL execution
- production data mutation
- cookie, token, session, storage, or provider payload inspection
- secret or environment value readback

## Decision

PASS.

The authenticated production UI source panel is visually usable in the supplied
desktop and mobile evidence. Generation-limited answers preserve source cards,
and the mobile source content does not push the composer out of the viewport.

## Verification Plan

Required local checks for this docs-only artifact:

| Check | Expected |
| --- | --- |
| `git diff --check -- docs/tasks/2026-05-13_compass_authenticated_source_panel_human_observation_result_v1.md` | pass |
| `npm run check:compass-source-panel-rendering` | pass |
| `npm run check:compass-chat-ui-state-contract` | pass |
| `npm run verify:harness` | pass |
| `git diff --cached --name-only` | no staged files before commit |

## Changed File

- `docs/tasks/2026-05-13_compass_authenticated_source_panel_human_observation_result_v1.md`

## Rollback

This is a docs-only QA artifact. Rollback is removing this file or reverting the
docs-only commit that adds it.
