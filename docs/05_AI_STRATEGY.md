# AI Strategy

## Two modes
1) Diagnose (cheap):
   - explain why slow using metrics + warehouse context
2) Rewrite (expensive):
   - propose rewritten SQL + rationale + risks + validation guidance

## Prompt inputs
- masked SQL + fingerprint
- key metrics (duration, reads, shuffle, spill, cache, waiting)
- frequency + p95 stats
- warehouse config + nearby warehouse events (if available)
- constraints: "preserve semantics", "avoid breaking null logic", "avoid hidden assumptions"

## Output contract (must be structured)
- Summary (2–3 bullets)
- Root causes (ranked)
- Rewrite SQL
- Rationale (mapped to observed metrics)
- Risks & semantic checks
- Validation plan (how to test safely)

## Safety
- default masking of literals
- never include secrets in prompts
- allow admin opt-in to include raw SQL
