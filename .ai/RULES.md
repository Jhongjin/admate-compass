# Compass Agent Rules

- Compass is AdMate Compass, not only a Meta FAQ chatbot.
- Do not describe Openclaw or Hermes as external products; they are Agent Core internal engines.
- Policy answers must prefer grounded sources over fluent unsupported claims.
- Do not remove source/citation/confidence fields from public answer contracts without explicit approval.
- Do not read, print, or commit `.env*` values, service role keys, tokens, or credentials.
- Debug/admin endpoints require extra caution and should not expose environment values or private rows.
- Deterministic checks belong in `scripts/`; non-deterministic RAG tuning belongs in skills, evaluation notes, and reviewed prompts.
