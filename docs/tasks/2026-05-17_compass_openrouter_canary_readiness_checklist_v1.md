# Compass OpenRouter Canary Readiness Checklist v1

Date: 2026-05-17
Repo: admate-compass
Status: open-beta readiness contract

## Scope

This checklist prepares Compass for OpenRouter/OpenAI-backed open-beta answer
generation without registering, testing, printing, or validating any real secret
value in the repo.

## Current Default

Compass may be left empty for production auto selection:

```text
COMPASS_ANSWER_PROVIDER=
```

Empty/auto provider selection uses the strongest configured server-side provider
first, then falls back to Ollama only when no remote key is available.

Provider behavior before canary:

```text
COMPASS_ANSWER_PROVIDER=openrouter  -> OpenRouter
COMPASS_ANSWER_PROVIDER=openai      -> OpenAI
COMPASS_ANSWER_PROVIDER=ollama      -> Ollama
COMPASS_ANSWER_PROVIDER=auto/empty  -> OpenRouter when configured, else OpenAI, else Ollama
```

Deployment examples may use an empty provider when server-side keys are present
and source-grounded output quality is the priority.

## Canary Preconditions

Before enabling OpenRouter in any target environment:

- register the OpenRouter key only as a server-side secret
- keep `NEXT_PUBLIC_OPENROUTER_*` and `NEXT_PUBLIC_COMPASS_OPENROUTER_*` absent
- set `COMPASS_ANSWER_PROVIDER=openrouter` explicitly when pinning is required,
  or leave it empty for auto selection
- set `COMPASS_ANSWER_MODELS` as an ordered fallback list
- keep retrieval, evidence filtering, source cards, and no-data behavior provider-agnostic
- run the local contracts before deployment

## Canary Validation

The canary should verify behavior, not secret values:

- a known answerable Compass question keeps citations/source cards
- a no-data fixture still returns no-data instead of a model guess
- rejected/fallback/placeholder evidence is not used as factual support
- provider/model labels are visible only as non-secret metadata
- latency/cost/source precision are reviewed before production rollout

## Rollback

Rollback to provider-isolated local generation should be a configuration-only change:

```text
COMPASS_ANSWER_PROVIDER=ollama
```

Do not remove or print secret values during rollback confirmation.

## Validation

Expected checks:

```text
npm run check:compass-answer-provider-contract
npm run check:compass-answer-route-contract
npm run check:compass-three-agent-reviewer-contract
npm run type-check
```
