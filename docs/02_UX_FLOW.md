# UX Flow + CTAs

## Step 0: Scope
Inputs:
- Warehouse
- Time window
- Slow definition (p95 vs threshold)
Primary CTA: Start analysis

## Step 1: Candidates Backlog
Table columns:
- Query fingerprint + preview
- Impact Score
- Frequency
- Total duration + p95
- Read bytes, shuffle, spill
- Cache flag, waiting-at-capacity
Row CTAs:
- Primary: Investigate
- Secondary: Generate rewrite, Watch, Dismiss

## Step 2: Query Detail
Sections:
- Header: statement_id, user/app, timestamps, status
- Timing breakdown: queue/compile/execute/fetch
- Resource signals: reads/rows/shuffle/spill/cache
- Similarity group: same fingerprint frequency
CTAs:
- Primary: Generate rewrite
- Secondary: Profile/Explain, Open Query History, Add tag

## Step 3: AI Rewrite Workbench
Tabs:
- Rewrite (diff + copy)
- Why (tied to metrics)
- Risks (semantics + edge cases)
CTAs:
- Primary: Validate (A/B)
- Secondary: Save draft, Share, Export

## Step 4: Validation
Show before/after metrics, multiple runs if desired.
CTAs:
- Primary: Approve recommendation
- Secondary: Needs review, Reject, Retest

## Step 5: Recommendations Backlog
States: Draft → Validated → Approved → Shipped → Monitoring
CTAs:
- Primary: Create ticket / Notify owner
- Secondary: Snooze, Close
