# Sprint 3 Summary — AI Diagnose + Rewrite Workbench

## What was built

1. **`lib/ai/promptBuilder.ts`** — Structured prompt construction:
   - Two modes: `diagnose` (cheap) and `rewrite` (expensive)
   - Includes masked SQL, execution metrics, performance flags, cost, context
   - Output contracts: `DiagnoseResponse` (summary, root causes, recommendations) and `RewriteResponse` (summary, root causes, rewritten SQL, rationale, risks, validation plan)
   - Estimated token counting for cost guardrails

2. **`lib/ai/aiClient.ts`** — Databricks AI integration:
   - Calls `ai_query()` SQL function via the existing SQL warehouse connection
   - Model selection: `databricks-meta-llama-3-3-70b-instruct`
   - Max input token guardrails (4K diagnose, 6K rewrite)
   - Max output token limits (2K diagnose, 4K rewrite)
   - Robust JSON parsing (handles markdown code fences, partial JSON)
   - Error detection for model not found, permissions, etc.

3. **`lib/ai/actions.ts`** — Server actions:
   - `diagnoseQuery()` — masks literals, calls diagnose mode
   - `rewriteQuery()` — sends raw SQL, calls rewrite mode

4. **AI panel on query detail page** (`/queries/[fingerprint]`):
   - Diagnose button → calls AI → shows results in tabbed panel
   - Generate Rewrite button → calls AI → shows results with tabs
   - Tabs: Summary / Root Causes / Rewrite / Risks / Validation Plan
   - "Open Workbench" link when rewrite is generated

5. **`/rewrite/[fingerprint]` workbench page**:
   - Side-by-side diff view (original vs rewritten SQL)
   - Copy buttons for both versions
   - AI generation with loading state
   - Rationale, Risks, and Validation Plan cards
   - "Validate" CTA linking to Sprint 4 validation page

## Guardrails implemented

- **Literal masking**: Diagnose mode always sends normalized SQL (literals replaced with `?`)
- **Token limits**: Rejects prompts exceeding max input tokens
- **Risks section**: Mandatory in rewrite output contract
- **Temperature**: Set to 0.1 for deterministic output

## Files changed

- `lib/ai/promptBuilder.ts` — NEW
- `lib/ai/aiClient.ts` — NEW
- `lib/ai/actions.ts` — NEW
- `app/queries/[fingerprint]/query-detail-client.tsx` — MODIFIED: integrated AI panel
- `app/rewrite/[fingerprint]/page.tsx` — NEW
- `app/rewrite/[fingerprint]/rewrite-workbench-client.tsx` — NEW
- `components/ui/tabs.tsx` — NEW (shadcn component)

## How to run

```bash
npm run dev
# Navigate to /queries/<fingerprint>
# Click "Diagnose" or "Generate Rewrite"
# For workbench: click "Open Workbench" or navigate to /rewrite/<fingerprint>
```

## Prerequisites

- Workspace must have Foundation Model APIs enabled
- Service principal needs access to `ai_query()` function
- `databricks-meta-llama-3-3-70b-instruct` model must be available

## Known issues

- AI response time varies (10-30s for rewrite mode)
- No streaming — full response returned at once
- If model is unavailable, user sees a clear error message
