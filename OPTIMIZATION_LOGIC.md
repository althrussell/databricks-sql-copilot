# SQL Optimization & Warehouse Sizing Logic

This document describes the complete decision-making logic used by the DBSQL Co-Pilot to advise customers on query optimization, warehouse sizing, and infrastructure recommendations. Every threshold, formula, and rule referenced here maps to code in the `lib/domain/` and `lib/ai/` directories.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Layer 1: Rule-Based Performance Flags](#layer-1-rule-based-performance-flags)
3. [Layer 2: Impact Scoring & Ranking](#layer-2-impact-scoring--ranking)
4. [Layer 3: Impact-Based Quality Gate](#layer-3-impact-based-quality-gate)
5. [Layer 4: Warehouse Sizing Recommendations](#layer-4-warehouse-sizing-recommendations)
6. [Layer 5: AI Triage](#layer-5-ai-triage)
7. [Layer 6: AI Deep Analysis & Rewrite](#layer-6-ai-deep-analysis--rewrite)
8. [Layer 7: Table Metadata Enrichment](#layer-7-table-metadata-enrichment)
9. [Layer 8: Unified Insight Record](#layer-8-unified-insight-record)
10. [Appendix: Databricks Knowledge Base (AI Prompt)](#appendix-databricks-knowledge-base)

---

## Architecture Overview

The system uses a multi-layer architecture where each layer plays to its strengths:

```
  Query History (system.query.history)
            |
            v
  ┌──────────────────────────┐
  │  Candidate Builder       │  Groups queries by SQL fingerprint,
  │  (candidate-builder.ts)  │  computes aggregate stats per pattern
  └──────────┬───────────────┘
             |
       ┌─────┴─────┐
       v            v
  ┌─────────┐  ┌──────────┐
  │ Scoring │  │ Perf     │   Deterministic, zero AI cost
  │ (0-100) │  │ Flags    │   15 flag types, impact-ranked
  └────┬────┘  └────┬─────┘
       |            |
       v            v
  ┌──────────────────────────┐
  │  Impact Quality Gate     │  Filters flags below 10% impact
  │  (filterAndRankFlags)    │  Ranks by estimated task-time %
  └──────────┬───────────────┘
             |
             v
  ┌──────────────────────────┐
  │  AI Triage (Llama 4)     │  Batch analysis of top 15 patterns
  │  + Table Metadata        │  Includes Unity Catalog context
  └──────────┬───────────────┘
             |
             v
  ┌──────────────────────────┐
  │  AI Deep Analysis        │  Claude Opus for detailed diagnosis
  │  (on-demand per query)   │  Full SQL + metadata + warehouse config
  └──────────────────────────┘
```

**Key principle:** The AI is the *explainer and rewriter*, not the primary *detector*. Rule-based detection is fast, free, deterministic, and consistent. The AI confirms, refines, and expands on what the rules find.

---

## Layer 1: Rule-Based Performance Flags

**Source:** `lib/domain/performance-flags.ts`

Every query pattern is evaluated against 15 performance flags. Each flag has a threshold, severity logic, and an estimated impact percentage.

### Default Thresholds

| Flag | Threshold | Metric | Critical If |
|------|-----------|--------|-------------|
| **LongRunning** | p95 > 30s | `p95Ms` | p95 > 90s (3x) |
| **HighSpill** | > 100 MB spill | `totalSpilledBytes` | > 500 MB (5x) |
| **HighShuffle** | > 500 MB shuffle | `totalShuffleBytes` | -- |
| **LowCacheHit** | I/O cache < 30% | `avgIoCachePercent` | < 10% |
| **LowPruning** | Pruning < 30% | `avgPruningEfficiency` | -- |
| **HighQueueTime** | Avg queue > 5s | `avgQueueWaitMs` | > 15s (3x) |
| **HighCompileTime** | Avg compile > 3s | `avgCompilationMs` | -- |
| **FrequentPattern** | > 50 executions | `count` | -- |
| **CacheMiss** | Result cache < 20% | `cacheHitRate` | -- |
| **LargeWrite** | > 1 GB written | `totalWrittenBytes` | -- |
| **ExplodingJoin** | produced/read > 2x | rows ratio | > 10x (5x threshold) |
| **FilteringJoin** | read/produced > 10x | rows ratio | -- |
| **HighQueueRatio** | queue > 50% of exec | `avgQueueWaitMs/avgExecutionMs` | > 100% |
| **ColdQuery** | result cache < 10% AND I/O cache < 10% | combined cache metrics | -- |
| **CompilationHeavy** | compile > 30% of (compile+exec), compile > 1s | time ratio | -- |

### Detection Logic

**LongRunning** — Fires when the 95th-percentile latency for a query pattern exceeds 30 seconds. Severity escalates to critical at 3x the threshold (90s). This is a meta-flag indicating the pattern warrants investigation.

**HighSpill** — Fires when total bytes spilled to disk across all executions exceeds 100 MB. Spill occurs when hash joins, sorts, or aggregations exceed available memory, forcing data to local disk. High spill strongly suggests the warehouse needs a larger T-shirt size (more memory per node), not just query changes.

**HighShuffle** — Fires when total shuffle read bytes exceeds 500 MB. High shuffle indicates data is moving between nodes extensively, often due to joins on non-co-located data or large GROUP BY operations.

**LowCacheHit** — Fires when the average I/O cache hit percentage is below 30% across more than 1 execution. Low I/O cache means the query is reading from cloud storage rather than local SSD cache. This often indicates the table needs OPTIMIZE (file compaction) or Liquid Clustering to improve data locality.

**LowPruning** — Fires when average file pruning efficiency is below 30% and the query reads rows. Low pruning means Delta's data-skipping statistics are not effectively filtering files. Almost always means the table needs Liquid Clustering on the columns used in WHERE clauses.

**HighQueueTime** — Fires when average queue wait exceeds 5 seconds. Queries are waiting for available compute slots. This is a capacity problem, not a query problem.

**HighCompileTime** — Fires when average compilation time exceeds 3 seconds. High compilation suggests complex views, deeply nested CTEs, or queries referencing many small tables.

**FrequentPattern** — Fires when a query fingerprint runs more than 50 times in the analysis window. High frequency amplifies the impact of any per-execution inefficiency.

**CacheMiss** — Fires when the result cache hit rate is below 20% across more than 2 executions. Low result cache means the query is being re-computed every time. On tables with frequent writes, result cache invalidates on any write — consider Materialized Views instead.

**LargeWrite** — Fires when total bytes written exceeds 1 GB. Large write operations may cause concurrent write conflicts or trigger excessive Delta log updates.

**ExplodingJoin** — Fires when produced rows are more than 2x the read rows. This is a strong signal of cross joins, many-to-many joins, or range joins without equi-conditions. The join is amplifying the data volume dramatically.

**FilteringJoin** — Fires when read rows exceed produced rows by more than 10x. The join is effectively filtering out most of the data *after* reading and shuffling it. Adding a pre-filter before the join would reduce the work significantly.

**HighQueueRatio** — Fires when queue wait is more than 50% of actual execution time. Unlike `HighQueueTime` which uses an absolute threshold, this detects *proportional* bottlenecks. If a query takes 2 seconds to execute but waits 1.5 seconds in queue, that's a scaling problem regardless of the absolute numbers.

**ColdQuery** — Fires when both result cache hit rate is below 10% AND I/O cache is below 10%, across 3+ executions. The query never benefits from any caching layer — it's always "cold." This strongly suggests the underlying table needs OPTIMIZE or Liquid Clustering to improve scan performance.

**CompilationHeavy** — Fires when compilation consumes more than 30% of the combined compile + execute time, and compilation exceeds 1 second. This pattern is typical of queries with deeply nested views, many small table references, or complex CTEs that the optimizer must expand.

### Impact Estimation Formulas

Each flag calculates an `estimatedImpactPct` representing the percentage of total task time this issue accounts for:

| Flag | Impact Formula |
|------|----------------|
| LongRunning | `(p95Ms - threshold) / p95Ms * 100` |
| HighSpill | `spilledBytes / (readBytes + spilledBytes) * 100` |
| HighShuffle | `min(100, shuffleBytes / readBytes * 50)` |
| LowCacheHit | `100 - avgIoCachePercent` |
| LowPruning | `(1 - pruningEfficiency) * 100` |
| HighQueueTime | `avgQueueWaitMs / totalTaskTimeMs * 100` |
| HighCompileTime | `avgCompilationMs / totalTaskTimeMs * 100` |
| CacheMiss | `(1 - cacheHitRate) * 80` |
| ExplodingJoin | `excessRows / totalProducedRows * 100` |
| FilteringJoin | `wastedRows / totalReadRows * 100` |
| HighQueueRatio | `avgQueueWaitMs / totalTaskTimeMs * 100` |
| ColdQuery | `min(80, (1 - cacheHitRate) * (100 - avgIoCachePercent))` |
| CompilationHeavy | `avgCompilationMs / totalTaskTimeMs * 100` |

Where `totalTaskTimeMs = avgCompilationMs + avgQueueWaitMs + avgComputeWaitMs + avgExecutionMs + avgFetchMs`.

---

## Layer 2: Impact Scoring & Ranking

**Source:** `lib/domain/scoring.ts`

Every query pattern receives a composite impact score from 0 to 100, computed from five weighted factors.

### Scoring Weights

| Factor | Weight | What It Measures |
|--------|--------|------------------|
| **Runtime** | 0.30 | How slow is the query? (p95 latency) |
| **Frequency** | 0.25 | How often does it run? (execution count) |
| **Waste** | 0.20 | How much spill vs data read? (memory pressure) |
| **Capacity** | 0.15 | How long does it wait in queue? (cluster pressure) |
| **Quick Win** | 0.10 | How cacheable is it? (low cache = easy improvement) |

### Factor Formulas (each produces 0-100)

| Factor | Formula | Example Values |
|--------|---------|----------------|
| Runtime | `min(100, round(20 * ln(p95_seconds + 1)))` | 1s = 20, 10s = 50, 60s = 80, 300s+ = 100 |
| Frequency | `min(100, round(20 * ln(count)))` | 1 = 5, 10 = 30, 100 = 60, 1000+ = 90+ |
| Waste | `min(100, round(spilledBytes / readBytes * 100))` | 0% = 0, 10% = 30, 50% = 70, 100%+ = 100 |
| Capacity | `min(100, round(20 * ln(avgQueueWait_seconds + 1)))` | 0s = 0, 1s = 20, 5s = 50, 30s = 80, 60s+ = 100 |
| Quick Win | `min(100, round((1 - cacheHitRate) * 80))` | 100% cached = 0, 0% cached = 80 |

### Final Score

```
impactScore = round(runtime * 0.30 + frequency * 0.25 + waste * 0.20 + capacity * 0.15 + quickwin * 0.10)
```

### Derived Tags

Tags are assigned when a factor score exceeds a threshold:

| Tag | Condition |
|-----|-----------|
| `slow` | runtime score >= 70 |
| `frequent` | frequency score >= 60 |
| `high-spill` | waste score >= 50 |
| `capacity-bound` | capacity score >= 50 |
| `mostly-cached` | cacheHitRate > 0.8 |
| `quick-win` | quickwin score >= 60 AND count >= 10 |

---

## Layer 3: Impact-Based Quality Gate

**Source:** `lib/domain/performance-flags.ts` (`filterAndRankFlags`)

Following the Databricks PRD principle: *"Only insights above 10% of query's total task time will be selected."*

### Filtering Rules

1. Flags with `estimatedImpactPct >= 10` are **kept**
2. Flags with `estimatedImpactPct < 10` are **silently dropped** (noise reduction)
3. Flags without an impact estimate (e.g., `FrequentPattern`, `LargeWrite`) are **kept** as-is
4. Remaining flags are **sorted by impact descending** — highest impact first
5. Unmeasured flags are appended after measured flags

This ensures customers only see actionable, high-impact findings.

---

## Layer 4: Warehouse Sizing Recommendations

**Source:** `lib/domain/warehouse-recommendations.ts`

The recommendation engine evaluates 7-day health metrics per warehouse and produces one recommendation per warehouse. Recommendations are deterministic (no AI involved).

### Data Sources

- **Per-day health metrics**: spill (GiB), capacity queue time (min), cold start wait (min), query count, p95 latency
- **Warehouse config**: T-shirt size, min/max clusters, auto-stop minutes, warehouse type
- **Cost data**: weekly DBUs, weekly cost in dollars
- **Hourly activity**: per-hour query counts and metrics
- **User attribution**: top users and query sources

### Sustained Pressure Analysis

A metric must exceed its per-day threshold on multiple days to trigger a recommendation:

| Metric | Per-Day Threshold | 7-Day Total Threshold |
|--------|-------------------|-----------------------|
| Spill | > 0.5 GiB/day | >= 1.0 GiB total |
| Capacity Queue | > 2.0 min/day | >= 10.0 min total |
| Cold Start | > 1.0 min/day | >= 5.0 min total |

**Sustained pressure is required for triggering:**
- `highSpill`: total >= 1.0 GiB AND bad days >= 3 of 7
- `highCapacityQueue`: total >= 10.0 min AND bad days >= 3 of 7
- `highColdStart`: total >= 5.0 min AND bad days >= 3 of 7

**Low pressure (for downsize):**
- `totalSpillGiB <= 0.1` AND `totalCapacityQueueMin <= 1.0` AND `(capacityQueue + coldStart) <= 1.0`

### Confidence Scoring

| Confidence | Condition |
|------------|-----------|
| **High** | Sustained on >= 5 of 7 days AND >= 100 queries |
| **Medium** | Sustained on >= 3 of 7 days |
| **Low** | Seen on 1-2 days or no sustained pattern |

### Size Multipliers (DBU Ratios)

| Size | Multiplier | Relative to 2X-Small |
|------|------------|----------------------|
| 2X-Small | 1x | baseline |
| X-Small | 2x | 2x |
| Small | 4x | 4x |
| Medium | 8x | 8x |
| Large | 16x | 16x |
| X-Large | 32x | 32x |
| 2X-Large | 64x | 64x |
| 3X-Large | 128x | 128x |
| 4X-Large | 256x | 256x |

### Recommendation Rules (Priority Order)

Rules are evaluated top-to-bottom. The first matching rule wins.

**Rule 1 — Switch to Serverless**
- Condition: `highColdStart AND NOT isServerless`
- Action: Recommend Serverless SQL
- Rationale: Quantifies cold start minutes, estimates affected queries, shows Serverless cost comparison
- If auto-stop < 5 min, calls out the frequent restart problem

**Rule 2 — Upsize AND Scale**
- Condition: `highSpill AND highCapacityQueue`
- Action: Upsize to next T-shirt size AND add up to 2 clusters (max 10)
- Rationale: Spill = memory problem, queue = concurrency problem. Both need addressing.
- If already at max size or max clusters, suggests query optimization or Serverless

**Rule 3 — Upsize Only**
- Condition: `highSpill` (without queue pressure)
- Action: Upsize to next T-shirt size
- Rationale: Queries are spilling because the warehouse memory is insufficient. Doubling the size doubles available memory.

**Rule 4 — Add Clusters**
- Condition: `highCapacityQueue` (without spill)
- Action: Increase max clusters by 2 (up to 10)
- Rationale: Queries are waiting for compute slots. More clusters improve concurrency.

**Rule 4b — Queue-Ratio Scaling** (new)
- Condition: `queueRatioHigh AND totalQueries >= 50 AND NOT highSpill`
- Queue ratio: `totalCapacityQueueMin / (avgRuntimeSec * totalQueries / 60) > 0.5`
- Action: Add clusters
- Rationale: Even if absolute queue time is moderate, if queries spend more than 50% of their processing time waiting, it's a concurrency bottleneck

**Rule 5 — Downsize**
- Condition: `lowPressure AND activeDays >= 3 AND totalQueries >= 50`
- Action: Downsize to previous T-shirt size
- Rationale: Warehouse has minimal pressure — savings possible without impacting users
- Shows estimated cost savings percentage

**Rule 6 — Increase Auto-Stop**
- Condition: `totalColdStartMin > 1 AND autoStopMinutes < 5`
- Action: Increase auto-stop to `min(current + 10, 30)`
- Rationale: Low auto-stop causes frequent warehouse stops and restarts
- Quantifies the trade-off: extra weekly idle cost vs cold start wait saved
- Suggests Serverless as an alternative that eliminates the trade-off

**Rule 7 — Decrease Auto-Stop**
- Condition: `lowPressure AND autoStopMinutes > 30`
- Action: Decrease auto-stop to `max(current - 15, 10)`
- Rationale: Low utilization with high auto-stop wastes compute on idle time
- Quantifies estimated weekly savings

**Rule 8 — No Change (Healthy)**
- Condition: None of the above trigger
- Action: No change needed
- Rationale: No performance issues detected over the past 7 days

### Cost Estimation

- **Size change**: `newCost = currentCost * (targetMultiplier / currentMultiplier)`
- **Cluster change**: `newCost = currentCost * (targetMaxClusters / currentMaxClusters)`
- **Wasted queue cost**: `wastedMinutes * (weeklyCost / (totalActiveMinutes + wastedMinutes))`
- **Auto-stop trade-off**: `extraIdleMinPerDay * activeDays * costPerMinute`

---

## Layer 5: AI Triage

**Source:** `lib/ai/triage.ts`, `lib/ai/triage-monitor.ts`

AI triage provides a 1-2 sentence insight per query pattern, confirming or refining what the rule-based detection found.

### Configuration

| Setting | Value |
|---------|-------|
| Model | `databricks-llama-4-maverick` |
| Max patterns per batch | 15 |
| Timeout | 60 seconds |

### What Is Sent to the AI

For each of the top 15 candidates (by impact score):

**Dashboard triage** (`triage.ts`):
```
ID | Type | SQL (200 chars) | p95, runs, cost |
Read (bytes, rows), produced rows (ratio) |
Spill, pruning % | Cache: IO %, result % |
Queue avg (% of exec) | App | Flags
```

**Monitor triage** (`triage-monitor.ts`):
```
ID | Type | SQL (150 chars) | Runs, avg, max |
Read (bytes), produced rows |
Spill, cache % | Queue avg (% of duration) |
App | Users
```

### Table Context (Unity Catalog)

Both triage modules now fetch lightweight table metadata for context:
- Table names are extracted from all SQL texts
- Deduplicated across candidates, capped at 10 tables
- Only DESCRIBE DETAIL is fetched (fast, one SQL call per table)
- Cached in memory for the server session

Format included in the prompt:
```
<tableName>, clustered on [col1, col2], partitioned by [date], managed, PO enabled, 2.3GB in 145 files
```

### Best Practices Encoded in the Prompt

The AI is instructed to flag:

1. Low pruning efficiency (< 50%) → recommend Liquid Clustering
2. Large full table scans → recommend Liquid Clustering + Predictive Optimization
3. Many GB read with poor cache → recommend OPTIMIZE + Predictive Optimization
4. Always prefer Liquid Clustering over Z-ORDER
5. Produced rows >> read rows (> 2x) → flag as Exploding Join
6. Read rows >> produced rows (> 10x) → flag as Filtering Join
7. Queue wait > 50% of execution → recommend scaling, NOT query rewrites
8. High spill relative to read → recommend larger warehouse size
9. BI tool + low pruning → check filter pushdown settings
10. Repeated aggregation + low cache + frequent writes → recommend Materialized Views

### Action Categories

| Action | Meaning |
|--------|---------|
| `rewrite` | SQL can be improved (rewrite, restructure) |
| `cluster` | Table needs Liquid Clustering |
| `optimize` | Table needs OPTIMIZE/VACUUM/compaction |
| `resize` | Warehouse sizing issue (upsize, add clusters, Serverless) |
| `investigate` | Needs deeper analysis (complex or ambiguous) |

---

## Layer 6: AI Deep Analysis & Rewrite

**Source:** `lib/ai/promptBuilder.ts`

On-demand per query, using a more capable model (Claude Opus). Only triggered when a user clicks "Analyze" or "Optimize" on a specific query.

### Two Modes

**Diagnose mode** — Explains why the query is slow with evidence:
- Output: summary bullets, root causes (with evidence and severity), recommendations
- Each root cause cites specific metric values
- Recommendations include exact SQL commands (ALTER TABLE, OPTIMIZE, etc.)

**Rewrite mode** — Proposes an optimized SQL rewrite:
- Output: summary, root causes, rewritten SQL, rationale, risks, validation plan
- Strict semantic equivalence required (same columns, rows, values, types, ordering)
- If SQL cannot be improved, returns original SQL with infrastructure recommendations
- 10 common rewrite patterns are encoded (predicate pushdown, QUALIFY, broadcast hints, etc.)

### Data Provided to the AI

The deep analysis receives significantly more context than triage:

1. **Full SQL** (or normalized fingerprint)
2. **Execution Timeline**: compilation, queue wait, compute wait, execution, fetch — all broken down
3. **I/O Metrics**: data read/written, rows read/produced, spill, shuffle, cache hit rates, pruning efficiency, task parallelism
4. **Volume**: execution count, p50/p95 latency, total wall time, impact score
5. **Cost**: estimated dollars and DBUs
6. **Performance Flags**: all detected flags with severity and detail
7. **Warehouse Config**: size, cluster scaling, auto-stop
8. **Full Table Metadata**: table type, clustering columns, partition columns, maintenance history (OPTIMIZE/VACUUM/ANALYZE), Predictive Optimization status, column schema, metric view definitions

---

## Layer 7: Table Metadata Enrichment

**Source:** `lib/queries/table-metadata.ts`

Table metadata is fetched from Unity Catalog to give the AI and rule-based systems real context about the tables a query touches.

### Extraction

Table names are extracted from SQL using regex pattern matching against keywords: `FROM`, `JOIN` (all types), `INTO`, `UPDATE`, `MERGE INTO`, `TABLE`. Requires at least 2-part names (`schema.table`). System tables are excluded.

### Full Metadata (Deep Analysis)

Fetched via 4 SQL calls per table, capped at 5 tables:

| Source | Data |
|--------|------|
| `DESCRIBE DETAIL` | format, location, managed/external, numFiles, sizeInBytes, partitionColumns, clusteringColumns, properties, tableFeatures |
| `INFORMATION_SCHEMA.COLUMNS` | column names, types, nullability, partition ordinal, comments |
| `DESCRIBE TABLE EXTENDED ... AS JSON` | full definition, metric view detection |
| `describe_history()` | last OPTIMIZE, VACUUM, ANALYZE timestamps and counts |

### Lightweight Metadata (Triage)

Fetched via DESCRIBE DETAIL only, capped at 10 tables, cached in memory:

| Field | Source |
|-------|--------|
| Clustering columns | `clusteringColumns` from DESCRIBE DETAIL |
| Partition columns | `partitionColumns` from DESCRIBE DETAIL |
| Managed / External | Detected from `location` field (cloud storage prefix = external) |
| Predictive Optimization | Detected from `delta.enableOptimizeWrite`, `delta.enablePredictiveOptimization`, or table features |
| Size & file count | `sizeInBytes`, `numFiles` |

### Predictive Optimization Detection

A table is considered to have Predictive Optimization enabled if ANY of:
- `delta.enableOptimizeWrite = "true"` in table properties
- `delta.enablePredictiveOptimization = "true"` in table properties
- Any table feature contains the word "predictive" (case-insensitive)

---

## Layer 8: Unified Insight Record

**Source:** `lib/domain/types.ts`, `lib/queries/performance-insights.ts`

All insights (rule-based, AI, or future system table) are represented as a unified `InsightRecord`.

### Insight Sources

| Source | Description |
|--------|-------------|
| `builtin_rule` | Deterministic rule-based detection (performance flags, warehouse recommendations) |
| `ai_triage` | AI-generated triage insight (Llama 4 Maverick) |
| `ai_deep_analysis` | AI-generated deep analysis (Claude Opus) |
| `system_table` | Future: `system.query.performance_insights` Databricks system table |

### Target Surfaces

| Surface | What Needs to Change |
|---------|----------------------|
| `query` | The SQL query itself (rewrite, restructure) |
| `table` | Table storage layout (clustering, partitioning, OPTIMIZE) |
| `compute` | Warehouse configuration (size, clusters, auto-stop) |
| `cloud_storage` | Cloud storage settings (cross-region, quotas) |

### Flag-to-Insight Mapping

| Performance Flag | Insight Type | Target Surface | Default Action |
|------------------|-------------|----------------|----------------|
| LongRunning | Long Running Query | query | investigate |
| HighSpill | Spill to Disk | compute | resize |
| HighShuffle | High Shuffle | query | rewrite |
| LowCacheHit | Low I/O Cache Hit | table | optimize |
| LowPruning | Low Pruning Efficiency | table | cluster |
| HighQueueTime | Long Queueing | compute | resize |
| HighCompileTime | High Compilation Time | query | investigate |
| FrequentPattern | Frequent Query Pattern | query | optimize |
| CacheMiss | Result Cache Miss | query | optimize |
| LargeWrite | Large Write Operation | query | investigate |
| ExplodingJoin | Exploding Join | query | rewrite |
| FilteringJoin | Filter Before Join | query | rewrite |
| HighQueueRatio | Queue-Dominated Execution | compute | resize |
| ColdQuery | Always-Cold Query | table | optimize |
| CompilationHeavy | Compilation-Heavy Query | query | investigate |

### Source Configuration

The `INSIGHT_SOURCE` environment variable controls which sources are active:

| Value | Behavior |
|-------|----------|
| `builtin` (default) | Only rule-based detection + AI triage |
| `system_table` | Only `system.query.performance_insights` (future) |
| `hybrid` | Merge both sources; system table takes priority for duplicate insight types |

---

## Appendix: Databricks Knowledge Base

The following knowledge is encoded in the AI system prompts (both triage and deep analysis). This is the expert context the AI uses when generating insights.

### The Three Pillars

Every query analysis checks and recommends:

1. **Managed Tables** — External tables should be converted to Unity Catalog managed tables for governance, lineage, and Predictive Optimization eligibility.
2. **Liquid Clustering** — The single most impactful storage optimization. Replaces both Z-ORDER and traditional partitioning. Auto-compacts and co-locates data.
3. **Predictive Optimization** — Automatically runs OPTIMIZE, VACUUM, and ANALYZE. Eliminates manual maintenance schedules.

### Warehouse Sizing Guidance

| Query Type | Recommendation |
|------------|----------------|
| Narrow transforms (filters, aggregations, simple scans) | More clusters (scale-out) — improves concurrency |
| Wide transforms (joins, sorts, window functions, shuffles) | Larger T-shirt size (scale-up) — more memory per node |
| Queue wait > 50% of execution time | Scaling problem, not query problem — add clusters or use Serverless |

### Query Tiers (Caching)

| Tier | Description | Optimization |
|------|-------------|--------------|
| Cold | First run, no cache. Full cloud storage read. | Liquid Clustering, OPTIMIZE |
| Warm | Metadata cached, data re-read. | Normal steady-state |
| Hot | Full result cache hit. Near-instant. | No action needed |

Note: Result cache invalidates on ANY write to the table. For frequently-written tables, Materialized Views are preferred over result cache.

### Anti-Patterns Detected

The system checks for 20+ anti-patterns including: full table scans, spill to disk, exploding joins, filtering joins, unnecessary aggregation, SELECT *, data skew, Cartesian products, DISTINCT vs GROUP BY inefficiency, NOT IN with NULLs, correlated subqueries, UNION vs UNION ALL, UDF overhead, over-partitioning, LIKE '%...%', unnecessary ORDER BY, missing predicate pushdown, unpartitioned window functions, long queueing, unused clustering keys, and incomplete optimizer statistics.

### Data Skipping Limits

Delta auto-collects min/max statistics on the **first 32 columns** by default. If filtered columns are beyond column 32, data skipping will NOT apply. Wide tables may need column reordering or reduced width.

### Type Mismatch Warning

If a WHERE clause compares a column with an implicit CAST (e.g., STRING column compared to INT literal), Delta statistics become unusable for that predicate. The optimizer cannot prune files. The fix is to ensure predicate types match column types exactly.

### File Size Guidance

| File Size | Issue | Fix |
|-----------|-------|-----|
| < 8 MB | Excessive file-open overhead, slow scans | Run OPTIMIZE |
| 32 - 256 MB | Optimal range | No action |
| > 1 GB | Harms point lookups, reads excess data | OPTIMIZE with target file size |

### BI Tool Integration

If `client_application` indicates Tableau, Power BI, Looker, or similar, and pruning is low:
- The BI tool may not be pushing filters down to the SQL layer
- Common issues: extract mode vs live connection, application-layer filtering, SELECT *
- Recommendation: verify BI connection settings and use custom SQL with explicit WHERE clauses

### Auto-Stop Trade-offs

| Setting | Pro | Con |
|---------|-----|-----|
| Low (< 5 min) | Saves idle cost | More cold starts, user wait |
| 10-15 min | Good balance for interactive | Moderate idle cost |
| > 30 min | Minimal cold starts | Significant idle cost |
| Serverless | No cold starts, no idle cost | Different pricing model |
