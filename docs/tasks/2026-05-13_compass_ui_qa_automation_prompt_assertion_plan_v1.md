# Compass UI QA Automation Prompt Assertion Plan

Date: 2026-05-13

## Background

The authenticated source-panel QA produced useful evidence for source preservation and mobile layout, but the noData screenshot did not visibly prove that the intended noData prompt was the prompt submitted for that specific response.

The follow-up authenticated backend shape recheck confirmed that the noData fixture currently returns:

```text
noDataFound: true
sourceCount: 0
```

This plan prevents future UI QA evidence from depending on ambiguous prompt submission state.

## Goal

Future Compass UI QA captures must prove three things before a state is accepted:

- The intended prompt is visible in the conversation.
- The result card belongs to that prompt.
- The expected source/noData/generation-limited state is visible after the prompt appears.

## Required Evidence Contract

For each UI fixture:

1. Submit the prompt once.
2. Wait until the exact prompt text appears in a user bubble.
3. Wait until the assistant response for that prompt reaches a terminal UI state.
4. Capture screenshot only after both the prompt and response state are visible.
5. If the prompt is not visible, mark the evidence inconclusive instead of pass/fail.

## Fixture-Specific Acceptance

Source-found:

- User prompt visible.
- Answer card visible.
- Source/evidence panel visible.
- Source count visible or inferable from rendered source cards.

NoData:

- User prompt visible.
- No-data state visible.
- Source/evidence cards absent.
- No generic source fallback visible.

Generation-limited:

- User prompt visible.
- Generation-limited or Ollama failure copy visible.
- Source cards preserved when verified sources are present.

Mobile:

- User prompt visible when fixture is conversational.
- Input remains in viewport.
- No horizontal overflow.
- Desktop source panel does not push answer/input off-screen.

## Automation Implementation Candidates

Preferred approach:

- Add a small browser QA helper that checks rendered text/state before screenshot capture.
- Keep it outside production runtime paths.
- Store only sanitized screenshots and a compact JSON-free result summary.

Potential helper assertions:

```text
assertPromptVisible(prompt)
assertTerminalAssistantState()
assertNoDataState()
assertSourcePanelVisible()
assertNoHorizontalOverflow()
```

## No-Touch Boundary

This plan does not require:

- RAGSearchService changes
- `/api/chat-ollama` logic changes
- DB/schema changes
- Reembedding or crawler execution
- Production SQL
- Raw source payload logging
- Cookie/token/session extraction

## Next Gate

Gate Compass-UI-QA-Automation-2:

Implement a test-only UI QA assertion helper or document the manual prompt-visible evidence checklist, then run it against local/dev fixtures before the next authenticated production UI QA.
