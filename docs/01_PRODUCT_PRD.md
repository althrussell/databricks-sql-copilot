# PRD — Databricks SQL Co-Pilot

## Users
- Primary: Platform Administrators / DBSQL admins
- Secondary: Data Engineers and Analysts (triaged via admin workflow)

## Core jobs-to-be-done
1. "Show me what’s slow and worth fixing."
2. "Explain why it’s slow (capacity vs query design)."
3. "Recommend a safe rewrite with clear expected impact."
4. "Validate improvement before shipping."
5. "Track wins and regressions over time."

## Success metrics
- Reduced p95 query latency for target warehouse(s)
- Reduced queue / waiting-at-capacity time
- Reduced spill/shuffle bytes for top offenders
- # validated rewrites per week
- Estimated cost savings (if billing join feasible)

## Non-goals (initial)
- Automatic rewriting + deployment without human review
- Full query profile DAG extraction
- Universal SQL linting for every query in the account

## MVP scope (Sprints 0–2)
- Warehouse scope selector + time window
- Candidate backlog with explainable ranking
- Query detail view with metrics breakdown
- AI diagnosis + rewrite draft
- Basic validation runner (before/after) + saving results
