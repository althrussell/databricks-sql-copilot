# AI Guardrails

- Do not send raw SQL with literals by default.
- Normalize and mask literals before passing to AI.
- Prompts must include:
  - query fingerprint + normalized SQL
  - key metrics (duration, reads, shuffle, spill, cache, waiting)
  - warehouse context (size, scaling events if known)
  - the goal: “reduce shuffle/scan/latency without changing semantics”
- Require a “Risk” section in AI output.
- Provide “Validate” as the primary CTA after rewrite generation.
