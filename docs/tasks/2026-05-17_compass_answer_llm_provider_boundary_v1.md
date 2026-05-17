# Compass Answer LLM Provider Boundary v1

Date: 2026-05-17
Repo: admate-compass
Status: provider activation contract

## Scope

This record documents the current Compass answer-model provider boundary before
any OpenRouter production activation.

No runtime provider behavior changes are made by this document. No real
OpenRouter key is registered, tested, printed, or validated in this slice.

## Current Runtime

- `/api/chat-ollama` remains the canonical Compass answer route.
- `/api/chatbot` remains legacy and points callers toward `/api/chat-ollama`.
- `CompassAnswerLlmService` owns answer-model selection.
- The OpenRouter adapter already exists and is server-side only.
- Local/Vultr Ollama remains available as the current fallback and development
  isolation path.

## Provider Selection Today

Current behavior:

```text
COMPASS_ANSWER_PROVIDER=ollama      -> Ollama
COMPASS_ANSWER_PROVIDER=openrouter  -> OpenRouter
COMPASS_ANSWER_PROVIDER=auto/empty  -> OpenRouter if a server-side key exists, otherwise Ollama
```

Important risk:

The current auto mode can switch to OpenRouter when a server-side key is
registered. That is acceptable only when the deployment gate intentionally wants
that behavior. Until the OpenRouter canary is approved, keep:

```text
COMPASS_ANSWER_PROVIDER=ollama
```

## Future OpenRouter Activation

When approved, OpenRouter should be activated explicitly with:

```text
COMPASS_ANSWER_PROVIDER=openrouter
COMPASS_ANSWER_MODELS=<OPENROUTER_MODEL_FALLBACKS_COMMA_SEPARATED>
OPENROUTER_API_KEY=<SERVER_ONLY_OPENROUTER_API_KEY>
```

Recommended model list should remain configuration-driven. Do not hardcode the
final paid production list until cost, latency, source precision, and provider
availability are reviewed.

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

This slice does not:

- change `/api/chat-ollama` behavior
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
