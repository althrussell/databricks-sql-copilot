/**
 * Candidate Scoring Model v1
 *
 * Produces an impact_score (0–100) with an explainable breakdown of 5 factors.
 * Each factor is scored 0–100, then weighted to produce the final score.
 *
 * Factors:
 *   runtime   — how slow is p95 relative to the window?
 *   frequency — how often does this query run?
 *   waste     — how much spill/shuffle relative to reads?
 *   capacity  — how much time spent waiting at capacity?
 *   quickwin  — is it cacheable or nearly cached already?
 *
 * Design: explainable > opaque. Each factor maps to an observable metric.
 */

import type { Candidate } from "@/lib/domain/types";

export interface ScoreInput {
  /** p95 duration for this fingerprint group (ms) */
  p95Ms: number;
  /** p50 duration for this fingerprint group (ms) */
  p50Ms: number;
  /** Number of executions in the time window */
  count: number;
  /** Total duration across all runs (ms) */
  totalDurationMs: number;
  /** Total spilled bytes across all runs */
  totalSpilledBytes: number;
  /** Total read bytes across all runs */
  totalReadBytes: number;
  /** Average waiting-at-capacity duration (ms) */
  avgWaitingAtCapacityMs: number;
  /** Fraction of runs served from result cache (0–1) */
  cacheHitRate: number;
}

export interface ScoreBreakdown {
  runtime: number;
  frequency: number;
  waste: number;
  capacity: number;
  quickwin: number;
}

export interface ScoreResult {
  impactScore: number;
  breakdown: ScoreBreakdown;
  tags: string[];
}

/** Weights must sum to 1.0 */
const WEIGHTS = {
  runtime: 0.30,
  frequency: 0.25,
  waste: 0.20,
  capacity: 0.15,
  quickwin: 0.10,
} as const;

/**
 * Score a candidate from grouped query run stats.
 *
 * All factor functions return 0–100 and are intentionally simple/transparent
 * so admins can understand "why ranked."
 */
export function scoreCandidate(input: ScoreInput): ScoreResult {
  const breakdown: ScoreBreakdown = {
    runtime: scoreRuntime(input.p95Ms),
    frequency: scoreFrequency(input.count),
    waste: scoreWaste(input.totalSpilledBytes, input.totalReadBytes),
    capacity: scoreCapacity(input.avgWaitingAtCapacityMs),
    quickwin: scoreQuickWin(input.cacheHitRate),
  };

  const impactScore = Math.round(
    breakdown.runtime * WEIGHTS.runtime +
    breakdown.frequency * WEIGHTS.frequency +
    breakdown.waste * WEIGHTS.waste +
    breakdown.capacity * WEIGHTS.capacity +
    breakdown.quickwin * WEIGHTS.quickwin
  );

  const tags = deriveTags(input, breakdown);

  return { impactScore: clamp(impactScore, 0, 100), breakdown, tags };
}

/**
 * Build the "Why ranked" explanation for a candidate.
 * Returns the top 2–3 contributing factors as human-readable strings.
 */
export function explainScore(breakdown: ScoreBreakdown): string[] {
  const factors: { key: string; score: number; label: string }[] = [
    { key: "runtime", score: breakdown.runtime, label: "Slow p95 execution time" },
    { key: "frequency", score: breakdown.frequency, label: "Runs frequently" },
    { key: "waste", score: breakdown.waste, label: "High spill/shuffle waste" },
    { key: "capacity", score: breakdown.capacity, label: "Waiting at capacity" },
    { key: "quickwin", score: breakdown.quickwin, label: "Cache optimization opportunity" },
  ];

  return factors
    .filter((f) => f.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((f) => f.label);
}

/* ── Factor scoring functions ── */

/**
 * Runtime: p95 duration mapped to 0–100.
 * 0ms → 0, 1s → 20, 10s → 50, 60s → 80, 300s+ → 100
 */
function scoreRuntime(p95Ms: number): number {
  if (p95Ms <= 0) return 0;
  const seconds = p95Ms / 1000;
  // Log-based curve: score = 20 * ln(seconds + 1), capped at 100
  return clamp(Math.round(20 * Math.log(seconds + 1)), 0, 100);
}

/**
 * Frequency: execution count mapped to 0–100.
 * 1 → 5, 10 → 30, 100 → 60, 1000+ → 90+
 */
function scoreFrequency(count: number): number {
  if (count <= 0) return 0;
  // Log-based: score = 20 * ln(count), capped at 100
  return clamp(Math.round(20 * Math.log(count)), 0, 100);
}

/**
 * Waste: spill ratio relative to reads.
 * 0% → 0, 10% → 30, 50% → 70, 100%+ → 100
 */
function scoreWaste(spilledBytes: number, readBytes: number): number {
  if (readBytes <= 0 || spilledBytes <= 0) return 0;
  const ratio = spilledBytes / readBytes;
  return clamp(Math.round(ratio * 100), 0, 100);
}

/**
 * Capacity: average waiting-at-capacity time.
 * 0ms → 0, 1s → 20, 5s → 50, 30s → 80, 60s+ → 100
 */
function scoreCapacity(avgWaitMs: number): number {
  if (avgWaitMs <= 0) return 0;
  const seconds = avgWaitMs / 1000;
  return clamp(Math.round(20 * Math.log(seconds + 1)), 0, 100);
}

/**
 * Quick win: inverse of cache hit rate — low cache = high opportunity.
 * 100% cached → 0 (nothing to improve), 0% cached → 80 (big opportunity)
 */
function scoreQuickWin(cacheHitRate: number): number {
  return clamp(Math.round((1 - cacheHitRate) * 80), 0, 100);
}

/* ── Helpers ── */

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function deriveTags(input: ScoreInput, breakdown: ScoreBreakdown): Candidate["tags"] {
  const tags: string[] = [];
  if (breakdown.runtime >= 70) tags.push("slow");
  if (breakdown.frequency >= 60) tags.push("frequent");
  if (breakdown.waste >= 50) tags.push("high-spill");
  if (breakdown.capacity >= 50) tags.push("capacity-bound");
  if (input.cacheHitRate > 0.8) tags.push("mostly-cached");
  if (breakdown.quickwin >= 60 && input.count >= 10) tags.push("quick-win");
  return tags;
}
