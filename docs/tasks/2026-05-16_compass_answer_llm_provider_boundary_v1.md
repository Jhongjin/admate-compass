# Compass Answer LLM Provider Boundary

Date: 2026-05-16

## Decision

Compass retrieval remains owned by the internal RAG pipeline. The final answer model is now a provider-agnostic answer layer so production can use GPT, Claude, or Gemini through OpenRouter without coupling the source/evidence contract to a single model runtime.

## Runtime Policy

- Default runtime is `auto`.
- If an OpenRouter key is configured, Compass uses OpenRouter.
- If OpenRouter is not configured, local/dev environments can still fall back to Ollama.
- Answer generation failures must not erase retrieved sources. The API returns `compass-answer-connection-failed` with preserved evidence sources.
- Rejected evidence is excluded before answer generation.
- Weak evidence may be shown to the model, but the system prompt requires operator-confirmation language instead of certainty.

## Recommended Model Order

Use `COMPASS_ANSWER_MODELS` as a comma-separated OpenRouter fallback list.

Recommended first production order:

1. `anthropic/claude-sonnet-4.5`
2. `openai/gpt-5-mini`
3. `google/gemini-2.5-pro`

Rationale:

- Claude Sonnet is the primary default for policy interpretation and careful Korean reasoning.
- GPT is a strong fallback for structured, concise operational answers.
- Gemini Pro is a useful third fallback for broad reasoning and vendor diversity.

The model order is deliberately environment-configured because OpenRouter model names and provider availability can change faster than the application release cycle.

## Environment Names

No secret values should be written to docs, logs, or commits.

- `COMPASS_ANSWER_PROVIDER=auto|openrouter|ollama`
- `OPENROUTER_API_KEY` or `COMPASS_OPENROUTER_API_KEY`
- `COMPASS_ANSWER_MODELS`
- `COMPASS_ANSWER_TEMPERATURE`
- `COMPASS_ANSWER_TOP_P`
- `COMPASS_ANSWER_MAX_TOKENS`
- `COMPASS_ANSWER_TIMEOUT_MS`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`

## Safety Boundaries

- The answer model receives only filtered evidence snippets, not credentials or raw environment state.
- The prompt instructs the model to answer only from provided sources and cite source labels.
- OpenRouter requests set provider data collection to `deny`.
- The UI treats any `*-connection-failed` model as generation-limited and keeps the source panel visible.

## Validation

Expected validation after implementation:

- `npm run check:rag-contract`
- `npm run check:compass-evidence-contract`
- `npm run evaluate:rag-fixtures -- --diagnostics`
- `npm run verify:harness`
- `npm run type-check`
- `npm run build`
