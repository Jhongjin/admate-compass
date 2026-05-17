# Compass OpenRouter Canary Readiness Checklist v1

Date: 2026-05-17
Repo: admate-compass
Status: readiness contract

## Scope

This checklist prepares Compass for a future OpenRouter answer-model canary
without registering, testing, printing, or validating any real secret value.
The runtime default is canary-safe: OpenRouter is not selected merely because a
server-side key exists.

## Current Default

Compass should remain pinned to Ollama until an explicit canary is approved:

```text
COMPASS_ANSWER_PROVIDER=ollama
```

This prevents `auto` mode from switching to OpenRouter merely because a
server-side key exists in an environment.

Provider behavior before canary:

```text
COMPASS_ANSWER_PROVIDER=ollama      -> Ollama
COMPASS_ANSWER_PROVIDER=openrouter  -> OpenRouter
COMPASS_ANSWER_PROVIDER=auto/empty  -> Ollama
```

Deployment examples must not use `COMPASS_ANSWER_PROVIDER=auto` as the default
before canary approval.

## Canary Preconditions

Before enabling OpenRouter in any target environment:

- register the OpenRouter key only as a server-side secret
- keep `NEXT_PUBLIC_OPENROUTER_*` and `NEXT_PUBLIC_COMPASS_OPENROUTER_*` absent
- set `COMPASS_ANSWER_PROVIDER=openrouter` explicitly for the canary target
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

Rollback should be a configuration-only change:

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
