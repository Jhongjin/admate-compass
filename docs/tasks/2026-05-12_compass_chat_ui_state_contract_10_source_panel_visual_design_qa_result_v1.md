# Compass Chat UI State Contract 10 Source Panel Visual Design QA Result v1

Date: 2026-05-12
Status: completed local/dev-only visual QA
Owner scope: `docs/tasks` result only
Repo: `D:\Projects\AdMate\admate-compass`
Preceded by: `docs/tasks/2026-05-12_compass_chat_ui_state_contract_9_source_panel_visual_design_qa_plan_v1.md`

## Boundary

This gate used the development-only fixture renderer at:

```text
http://127.0.0.1:3210/dev/chat-ui-state-fixtures
```

The server was started with `next dev -H 127.0.0.1 -p 3210`, inspected only on
localhost, then stopped. No login, real account/session, prompt submission,
production browsing, direct `/api/chat-ollama` call, RAG search, database work,
crawler, reembedding, source fixture mutation, or production deployment work was
performed.

`npm run build` and the local dev server reported normal Next env-file loading
from existing local files. Secret values were not read, printed, copied, edited,
or used for external calls in this gate.

## Visual QA Result

Local Chrome headless inspection covered all 10 committed synthetic fixtures
from `docs/rag/compass-chat-ui-state-contract-fixtures.json`.

Viewport coverage:

| Viewport | Result |
| --- | --- |
| `desktop-lg` / `1440x900` | Pass |
| `mobile` / `390x844` | Pass |
| `small-mobile` / `360x740` | Pass |

Fixture coverage:

| Fixture | Result |
| --- | --- |
| `chat-ui-initial-empty-source-panel` | Pass |
| `chat-ui-source-found-three-sources` | Pass |
| `chat-ui-source-found-long-korean-title` | Pass |
| `chat-ui-nodata-empty-source-panel` | Pass |
| `chat-ui-generation-limited-sources-preserved` | Pass |
| `chat-ui-error-no-sources` | Pass |
| `chat-ui-mobile-source-found-compact-panel` | Pass |
| `chat-ui-mobile-nodata-compact-panel` | Pass |
| `chat-ui-mobile-generation-limited-compact-panel` | Pass |
| `chat-ui-mobile-error-no-panel-trap` | Pass |

Observed automated layout checks:

- all 10 fixture sections rendered locally
- no horizontal page overflow at the reviewed viewport widths
- no detected per-section element overflow in the fixture panels
- visible controls met the checked minimum target threshold
- compact mobile panels stayed in the document flow
- no fixed overlay was detected covering the composer fixture
- long Korean source-title fixture remained within the measured frame width

Forbidden/internal/security/provider text was not visible in the renderer text:

```text
schema=compass
sourcesCount
retrievalMethod
sourceQuality
hybridScore
vectorScore
keywordScore
ollama_document_chunks
RAGSearchService
raw source
raw provider
raw payload
provider payload
stack trace
/api/chat-ollama
token
cookie
credential
secret
signedUrl
apiKey
privateKey
authorization
bearer
password
.env
SUPABASE
GEMINI
ANTHROPIC
OPENAI
```

Unsupported-state approval wording was not visible in `initial-empty`,
`noData`, or `error` fixture sections:

```text
verified source
accepted
allowed
safe
no issue
```

## Verification

Commands run:

```powershell
git cat-file -t dcc5215a8
git cat-file -t 77a84c61a
git diff --check
npm run verify:harness
npm run type-check
npm run build
npm run type-check
```

Results:

- `dcc5215a8` and `77a84c61a` exist locally as commits.
- `git diff --check` passed before this result doc was added.
- `npm run verify:harness` passed.
- first `npm run type-check` failed because stale generated `.next/types`
  entries referenced missing files.
- `npm run build` passed and regenerated `.next/types`.
- second `npm run type-check` passed after the build.

## No-Touch Confirmation

This gate did not modify:

- `src/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `docs/rag/`
- API routes
- `RAGSearchService`
- `/api/chat-ollama` production logic
- database/schema/migration/import/crawler/embedding paths
- env or secret files
- real session data

Changed artifact intended for review:

```text
docs/tasks/2026-05-12_compass_chat_ui_state_contract_10_source_panel_visual_design_qa_result_v1.md
```
