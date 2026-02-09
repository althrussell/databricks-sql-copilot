# Sprint 3 Prompt — AI Diagnose + Rewrite Workbench

Implement Sprint 3.

Add:
- /lib/ai/promptBuilder.ts (structured output contract)
- /lib/ai/aiClient.ts that calls Databricks ai_query or model endpoint (config-driven)
- Query Detail AI panel:
  - Diagnose button (cheap) + Rewrite button (expensive)
  - show results in Tabs: Summary / Root Causes / Rewrite / Risks / Validation plan
- /rewrite/[fingerprint] workbench page (store draft in memory or temp store)

Guardrails:
- Mask literals before sending to AI.
- Require “Risks” section.

Deliver:
- docs/output/SPRINT_3_SUMMARY.md
