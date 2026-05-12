# Compass Authenticated QA 5 Browser Session Attach Blocker

Date: 2026-05-13 KST

## Scope

This note records the current blocker for continuing authenticated Compass
production UI QA from the commander automation environment.

The user confirmed a manual login in a normal Chrome browser at:

`https://compass.admate.ai.kr/`

No cookie, token, session value, local storage, session storage, raw provider
payload, database row, signed URL, or secret value was inspected.

## Automation Check

The available Playwright automation context was opened to:

`https://compass.admate.ai.kr/chat-ollama`

Observed result:

- initial navigation title: `AdMate Compass - Policy Intelligence Agent`
- final page URL: `https://compass.admate.ai.kr/login?next=/chat-ollama`
- final page title: `AdMate Compass - Policy Intelligence Agent`

Interpretation:

The user's normal Chrome login session is not available inside the Playwright
automation context. Therefore, automated authenticated visual QA cannot safely
continue from this commander environment without an attachable authenticated
browser session or user-provided sanitized visual evidence.

## Status

Result: blocked by browser session boundary.

This is not a Compass product failure. It is an automation/session attachment
boundary between the user's manually logged-in browser and the isolated browser
context available to the commander environment.

## Allowed Next Inputs

Any one of the following can unblock the authenticated QA gate:

- provide an attachable remote-debug browser session that is already logged in
  to Compass
- provide sanitized screenshots for the approved desktop and mobile states
- provide manual pass/fail observations for the checklist in
  `2026-05-12_compass_chat_ui_state_contract_12_authenticated_production_source_panel_visual_qa_checklist_v1.md`

## Required Manual Observations

For a manual-only report, the minimum useful observations are:

- `/chat-ollama` opens after login without returning to `/login`
- desktop source panel is visible and does not overlap the answer area
- mobile viewport has no horizontal overflow
- composer/input remains inside the viewport on mobile
- long Korean source titles wrap without pushing content off-screen
- internal terms are not visible:
  - `retrievalMethod`
  - `sourceQuality`
  - `hybridScore`
  - `sourcesCount`
  - `ollama_document_chunks`

## No-Touch Confirmation

This gate did not perform:

- prompt submission
- direct `/api/chat-ollama` call
- RAGSearchService change
- API route change
- database, schema, import, crawler, or reembedding work
- environment change
- cookie, token, session, storage, or provider payload inspection
- code change
