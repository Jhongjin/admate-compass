# Compass Agent Memory

Project: AdMate Compass (`Jhongjin/admate-compass`)
Role: Policy and guide RAG platform for AdMate.

Compass answers advertising policy questions using indexed platform guide content. It should reduce policy lookup time while keeping source traceability visible.

AdMate relationships:
- Compass owns policy/guide RAG and policy intelligence.
- Openclaw/Agent Core owns workflow execution, monitoring, Slack, n8n, audit, and Hermes learning.
- Lens owns capture/evidence generation.
- Homepage owns public brand pages and executive Command Center display.
- admate-docs is the source of truth for strategy and product language.

Never output or request secrets, API keys, service role keys, tokens, or credential values.
