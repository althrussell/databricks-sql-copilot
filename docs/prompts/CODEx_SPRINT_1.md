# Sprint 1 Prompt — Candidate Backlog Ranking v1

Implement Sprint 1.

Add:
- SQL normalization + fingerprint in /lib/domain/sqlFingerprint.ts
- Candidate scoring model v1 in /lib/domain/scoring.ts (explainable breakdown)
- Unit tests for fingerprint + scoring
- Update backlog:
  - group runs by fingerprint, compute stats (count, p95, total duration)
  - compute impact_score and show “Why ranked”
  - actions: Investigate, Watch, Dismiss (state stored locally for now)

Deliver:
- docs/output/SPRINT_1_SUMMARY.md
