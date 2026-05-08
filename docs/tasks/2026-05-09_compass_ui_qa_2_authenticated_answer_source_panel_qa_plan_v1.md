# Gate Compass-UI-QA-2 Authenticated Answer/Source Panel QA Plan

Date: 2026-05-09
Repo: `D:\Projects\AdMate\admate-compass`
Production: `https://compass.admate.ai.kr`
Mode: planning only

## Goal

Plan a safe authenticated QA pass for the production `/chat-ollama` answer screen and source/evidence panel after the production root, metadata, public admin surface, and Compass-local login shell work.

This gate is planning only. It does not log in, submit a question, call production chat from the UI, modify code, stage files, commit, push, or change any database, schema, import, re-embedding, crawler, or Vercel setting.

## Preconditions

Completed baseline:

- Production root is aligned to AdMate Compass branding.
- Production metadata title is aligned to `AdMate Compass - Policy Intelligence Agent`.
- Public root no longer calls `/api/admin/dashboard`, `/api/admin/status`, or `/api/admin/users/check-admin`.
- Compass-local `/login` shell is live.
- No-session `/chat-ollama` redirects to `/login?next=/chat-ollama`.
- `/api/chat-ollama` production contract remains `schema=compass` with source evidence preserved.

Open reason for this gate:

- UI-QA-1 could not visually approve the production answer card and source/evidence panel because anonymous `/chat-ollama` access redirected away from the chat surface.
- Authenticated UI QA is now the next safe step, but it must be planned before any login or query execution.

## Account Conditions

Use only an approved QA account that meets all of the following:

- Dedicated to AdMate/Compass QA, not a personal operator account.
- Uses a company-approved email domain.
- Has explicit permission to access Compass production.
- Does not have elevated admin permissions unless the QA scenario explicitly requires them.
- Does not contain real campaign/client data in profile metadata.
- Can be disabled or rotated after QA if needed.

Do not use:

- A real Super Admin account.
- A personal production operator account.
- Any account whose password must be shared in chat, docs, screenshots, terminal output, or logs.
- Any account with unclear Compass entitlement.

## Login And Password Handling

Password/non-sharing principles:

- The user or approved operator enters the password directly in the browser.
- Codex must not ask the user to paste the password into chat.
- Codex must not print, store, screenshot, or log credentials.
- Browser screenshots must never include password text.
- If a password manager or manual entry is used, capture screenshots only after the password field is clear or masked and no credential value is visible.

Recommended login method:

1. Open `https://compass.admate.ai.kr/login?next=/chat-ollama`.
2. Confirm the Compass-local login shell copy is visible.
3. Let the approved operator enter credentials directly.
4. Confirm login success redirects to `/chat-ollama`.
5. Start UI QA only after `/chat-ollama` is loaded under the authenticated session.

Do not submit login in this planning gate.

## Question Fixture Candidates

Use a small fixture set that exercises evidence, no-data, long text, and generation-limited states without changing RAG code or data.

### Source-Found Fixtures

Use questions expected to return verified sources:

1. `Meta 광고 소재에서 과장 표현과 랜딩 페이지 관련 주의사항을 알려줘`
2. `Google 또는 YouTube 광고 정책에서 민감한 콘텐츠 표현은 어떻게 제한되나요?`
3. `Naver 광고 심사에서 랜딩 URL과 소재 문구를 확인할 때 주의할 점을 알려줘`
4. `Kakao 광고 소재 심사 기준에서 의료나 건강 관련 표현은 어떻게 확인해야 하나요?`

Expected UI:

- Answer card shows a Korean answer or generation-limited message.
- Source/evidence panel shows verified source cards.
- Source count and source card list match the API response shape at a user-visible level.
- Source panel does not expose raw internal fields such as `schema`, `sourcesCount`, `retrievalMethod`, or `sourceQuality`.

### No-Data Fixture

Use an intentionally out-of-corpus question:

```text
화성 거주용 산소 농장 광고의 3027년 심사 기준을 알려줘
```

Expected UI:

- Vendor-neutral noDataFound copy.
- No unsafe policy speculation.
- No unsupported answer pretending there is a source.
- Source panel shows a clear empty state such as no evidence found.

### Long Korean Text Fixture

Use a long, multi-part Korean question:

```text
Meta, Google, Naver, Kakao에서 화장품 광고 소재를 운영할 때 과장 표현, 전후 비교 이미지, 랜딩 페이지의 가격/혜택 표시, 사용자 후기 문구, 심사 보류 시 재검토 요청 절차를 각각 확인해야 하는데, 실무자가 체크리스트로 볼 수 있게 플랫폼별로 구분해서 설명해줘
```

Expected UI:

- User bubble handles long Korean text without horizontal overflow.
- Answer card wraps naturally.
- Source titles/excerpts stay within card boundaries.
- Right evidence panel does not force page-level horizontal scrolling.

## Source/Evidence Panel QA Scope

Check answer card and right-side source/evidence panel together.

Answer card:

- Korean answer is readable and not visually crowded.
- Source/evidence affordance is visible.
- If generation is limited, the answer card clearly says sources were still found or preserved.
- noDataFound state does not imply unsafe confidence.
- Feedback controls, retry controls, and metadata badges do not obscure answer text.

Source/evidence panel:

- Header clearly indicates evidence/source purpose, such as `근거 문서`.
- Source count is visible and understandable.
- Source cards show:
  - title
  - excerpt
  - evidence label
  - source availability label
  - corpus or source type label only if user-friendly
  - external/open icon only when a URL exists
- Source excerpt can expand/collapse without layout jumps.
- Long titles and long excerpts wrap safely.
- Empty state is helpful and vendor-neutral.
- Generation-limited state keeps source cards visible.

Known copy watchlist:

- `Compass verified source` remains an internal-style English phrase in current source code and should be specifically checked in production UI.
- `정책 근거 색인` and `Compass 색인` are acceptable but should be reviewed for user trust/tone.
- Raw field names must not appear: `retrievalMethod`, `sourceQuality`, `schema`, `sourcesCount`, `hybridScore`, `ollama_document_chunks`.

## noDataFound / Generation-Limited / Ollama Failure Scope

noDataFound:

- Use the no-data fixture only after authenticated QA is approved.
- Confirm no sources are shown as if verified.
- Confirm answer copy asks for more specific platform/policy/context without blaming a vendor.

Generation-limited / Ollama failure:

- Do not intentionally break production infrastructure.
- If production naturally returns `model=ollama-connection-failed` or generation-limited behavior during approved QA, record it.
- Confirm verified sources remain visible when retrieval succeeds.
- Confirm the UI distinguishes generation failure from retrieval failure.
- Confirm the user can still inspect source evidence.

Out of scope for this QA:

- Restarting or stopping Ollama.
- Changing environment variables.
- Triggering deployment or infrastructure changes.
- Editing `/api/chat-ollama`.

## Mobile Layout QA Scope

Use browser/device emulation only after login is established by the approved operator.

Recommended viewport set:

- Desktop: `1440x900`
- Tablet: `768x1024`
- Mobile: `390x844`
- Small mobile: `360x740`

Mobile checks:

- `/chat-ollama` authenticated page loads without horizontal overflow.
- Chat input remains reachable.
- Answer card is readable.
- Source/evidence panel is reachable through the intended mobile interaction.
- Sheet/drawer/source panel does not cover the input permanently.
- Source cards stay scrollable and do not trap focus.
- Long Korean text wraps within the viewport.
- Header/login/account controls do not overlap chat content.

## Long Korean Text Stability Scope

Check:

- Long user question bubble.
- Long answer paragraphs.
- Long source titles.
- Long source excerpts.
- Badges and labels inside compact source cards.
- Buttons with Korean text.
- Any generated answer with numbered lists or platform sections.

Pass criteria:

- No horizontal page scroll.
- No clipped Korean text in buttons or badges.
- No overlapping source cards.
- No card height jump that hides active content.
- No fixed panel that blocks the chat input on mobile.

## No-Touch Boundaries

Do not modify:

- `src/lib/services/RAGSearchService.ts`
- `src/app/api/chat-ollama/route.ts`
- DB schema or migrations
- import scripts
- re-embedding scripts
- crawler code
- corpus SQL
- Vercel project settings
- production environment variables

Do not perform:

- DB mutation
- migration
- import
- re-embedding
- crawler run
- deploy trigger
- credential output
- form submit in this planning gate

## Screenshot And Evidence Storage

Recommended storage path for the execution gate:

```text
docs/tasks/evidence/2026-05-09_compass_ui_qa_3/
```

Screenshot rules:

- Save only UI screenshots needed to prove layout and state.
- Redact or avoid email/account identifiers if visible.
- Never capture password values.
- Do not include browser password manager popups.
- Avoid screenshots containing secrets, tokens, or raw API payloads.
- Prefer descriptive filenames:
  - `desktop_source_found_answer_panel.png`
  - `mobile_source_found_drawer.png`
  - `desktop_no_data_found.png`
  - `desktop_generation_limited_sources_preserved.png`
  - `mobile_long_korean_answer.png`

Evidence log rules:

- Record URL path, viewport, fixture name, expected result, actual result, pass/fail, and screenshot filename.
- Do not paste full API responses into the QA doc.
- Summarize source counts and UI labels only.
- If a source URL is clicked, record only whether a new tab opens safely; do not download files unless explicitly approved.

## Execution Checklist For Next Gate

Before login:

- Confirm user has approved QA account.
- Confirm password will be entered directly by the operator.
- Confirm screenshot storage path.
- Confirm no production mutation will be performed.

After login:

- Confirm `/chat-ollama` authenticated route loads.
- Run source-found fixture 1.
- Capture desktop answer/source panel.
- Capture mobile answer/source panel.
- Run no-data fixture.
- Capture noDataFound answer/source state.
- Run long Korean fixture.
- Capture desktop and mobile long-text states.
- Record any natural generation-limited/Ollama failure state if it occurs.
- Confirm no raw internal field names are visible.

## Next Gate Proposal

`Gate Compass-UI-QA-3 authenticated answer/source panel production QA`

Recommended scope:

- Use an approved QA account.
- Have the operator enter the password directly.
- Execute the planned fixtures.
- Capture screenshots under the storage rules above.
- Produce a read-only QA report with pass/fail findings and screenshot references.
- Do not modify code in the same gate unless a separate implementation gate is approved.

Potential follow-up gates:

- `Gate Compass-UI-Fix-1 source panel trust copy polish`
- `Gate Compass-UI-QA-4 mobile authenticated source panel verification`
- `Gate Compass-Auth-7 account/profile link integration audit`
- `Gate AdMate-Product-Auth-Rollout-1 Lens/Foresight login shell planning`
