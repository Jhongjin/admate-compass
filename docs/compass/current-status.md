# AdMate Compass Current Status

Updated: 2026-06-27

This file contains volatile Compass status. Keep stable role and operating rules in `AGENTS.md`; keep changing status, frozen items, and handoff notes here.

## Session Startup

New Compass agents should read:

1. `D:\Projects\AdMate\WORKSPACE.md`
2. `D:\Projects\AdMate\admate-compass\AGENTS.md`
3. `D:\Projects\AdMate\admate-compass\docs\compass\current-status.md`
4. `D:\Projects\AdMate\admate-compass\README.md` if implementation context is needed

Do not recursively scan `D:\Projects\AdMate` unless Commander explicitly asks for a cross-repo audit.

## Confirmed State

- Dominance track is closed.
- Global source dominance penalty is not needed.
- Medium source relaxation is accepted after regex expansion because it contributes to cited source diversity.
- Shopping DB answer quality is accepted as usable; no further micro-adjustment is planned.
- The first bullet's S2 procedural citation is allowed. Do not revert it to S1 just to make citation intuition cleaner, because that risks reintroducing S1 dominance.

## Frozen Unless Commander Approves

- Do not remove or retire `ollama_document_chunks`.
- Do not switch the default value of `COMPASS_SEARCH_SOURCE`.
- Do not rewrite regression fixtures.
- Do not change `retrieval_limited` scoring or self-assessment logic.
- Do not introduce global source dominance penalty.
- Do not change production flags without preview measurement and Commander/audit approval.

## Backlog

- Reassess `retrieval_limited` scoring later. Current note: score 76 can be a side effect of document_chunks-era retrieval being richer than the old self-assessment criterion expects.

## Prompt Rule

Compass prompts should stay short and stable. Use this pattern:

```text
너는 AdMate Compass 담당 에이전트야.
작업 폴더는 D:\Projects\AdMate\admate-compass야.
먼저 D:\Projects\AdMate\WORKSPACE.md,
D:\Projects\AdMate\admate-compass\AGENTS.md,
D:\Projects\AdMate\admate-compass\docs\compass\current-status.md를 읽어.
내가 명시하지 않는 한 D:\Projects\AdMate 전체를 재귀 탐색하지 마.
현재 상태/동결 항목은 current-status.md를 기준으로 판단해.
```

## Handoff Rule

At the end of a Compass task, update this file only when the status changes. A handoff should include:

- branch and commit
- changed files
- validation run
- answer quality impact
- newly frozen or unfrozen items
- Commander approval needed or not
