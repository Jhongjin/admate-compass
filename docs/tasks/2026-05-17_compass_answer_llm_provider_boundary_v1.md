# Compass Answer LLM Provider Boundary v1

Date: 2026-05-17
Repo: admate-compass
Status: provider activation contract, open-beta auto provider selection

## Scope

This record documents the current Compass answer-model provider boundary for
open-beta operation.

No real OpenRouter key is registered in this repository artifact. Secret values
are never tested, printed, or validated in this record.

## Current Runtime

- `/api/compass-answer` is the canonical Compass answer route.
- `/api/chat-ollama` remains a legacy compatibility route.
- `/api/chatbot` remains legacy and points callers toward `/api/compass-answer`.
- `CompassAnswerLlmService` owns answer-model selection.
- The OpenRouter adapter already exists and is server-side only.
- Local/Vultr Ollama remains available as the last fallback and development
  isolation path.

## Provider Selection Today

Current behavior:

```text
COMPASS_ANSWER_PROVIDER=openrouter  -> OpenRouter, then OpenAI fallback when configured
COMPASS_ANSWER_PROVIDER=openai      -> OpenAI, then OpenRouter fallback when configured
COMPASS_ANSWER_PROVIDER=ollama      -> Ollama, then OpenRouter/OpenAI fallback when configured
COMPASS_ANSWER_PROVIDER=auto/empty  -> OpenRouter when a server key exists, else OpenAI, else Ollama
```

Important risk:

A server-side key must remain server-only and must never be exposed through
`NEXT_PUBLIC_*` variables, logs, or client responses. For open-beta stability,
an empty provider value is allowed to use the strongest configured server-side
provider before falling back to Ollama.
Empty/auto provider selection is therefore an intentional open-beta runtime
path, not a client-visible setting.

```text
COMPASS_ANSWER_PROVIDER=
```

## Explicit OpenRouter Pinning

When an environment must be pinned to OpenRouter, use:

```text
COMPASS_ANSWER_PROVIDER=openrouter
COMPASS_ANSWER_MODELS=<OPENROUTER_MODEL_FALLBACKS_COMMA_SEPARATED>
OPENROUTER_API_KEY=<SERVER_ONLY_OPENROUTER_API_KEY>
```

Recommended model list should remain configuration-driven. Do not hardcode the
final paid production list until cost, latency, source precision, and provider
availability are reviewed.

## OpenRouter Operation Gate

OpenRouter can be selected by explicit provider configuration or by empty/auto
provider selection when the server-side key exists.

For all environments:

- keep OpenRouter credentials server-only
- do not add `NEXT_PUBLIC_OPENROUTER_*`
- do not print, echo, or inspect secret values
- keep the model fallback list environment-configured
- run local contract checks before any deployment change

Explicit OpenRouter pinning:

```text
COMPASS_ANSWER_PROVIDER=openrouter
COMPASS_ANSWER_MODELS=<OPENROUTER_MODEL_FALLBACKS_COMMA_SEPARATED>
OPENROUTER_API_KEY=<SERVER_ONLY_OPENROUTER_API_KEY>
```

Canary success criteria:

- `/api/chat-ollama` still preserves source cards and no-data behavior
- answer provider metadata is visible only as non-secret labels
- rejected, fallback, placeholder, and weak-only evidence do not become final answer content
- latency, cost, model, and source precision are reviewed before production rollout

Rollback to local/provider-isolated generation:

```text
COMPASS_ANSWER_PROVIDER=ollama
```

## Server-Only Boundary

OpenRouter credentials must remain server-only.

Do not add:

```text
NEXT_PUBLIC_OPENROUTER_*
NEXT_PUBLIC_COMPASS_OPENROUTER_*
```

Provider metadata may be logged as status labels, but secret values must never
be printed.

## No-Touch Confirmation

This boundary does not:

- remove `/api/chat-ollama` compatibility behavior
- change `/api/chatbot` behavior
- register real OpenRouter secrets
- call OpenRouter
- call Ollama
- inspect `.env.local`, `.env.production`, `.env.vercel`, `.env.render`, or
  `.env.migration`
- touch `next-env.d.ts`

## Validation

Expected checks:

```text
npm run check:compass-answer-route-contract
npm run check:compass-answer-provider-contract
npm run check:compass-three-agent-reviewer-contract
npm run type-check
```
