"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Timer,
  Rows3,
  Save,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  runValidationAction,
  saveRecommendationAction,
  type ValidationSummary,
} from "@/lib/dbx/actions";
import { rewriteQuery } from "@/lib/ai/actions";
import type { Candidate } from "@/lib/domain/types";
import type { RewriteResponse } from "@/lib/ai/promptBuilder";
import type { AiResult } from "@/lib/ai/aiClient";

interface ValidateClientProps {
  candidate: Candidate;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function ValidateClient({ candidate }: ValidateClientProps) {
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [rewriting, startRewrite] = useTransition();
  const [validating, startValidate] = useTransition();
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState(3);

  const rewriteData =
    aiResult?.status === "success" && aiResult.mode === "rewrite"
      ? (aiResult.data as RewriteResponse)
      : null;

  const handleGenerate = () => {
    setError(null);
    startRewrite(async () => {
      const result = await rewriteQuery(candidate);
      setAiResult(result);
      if (result.status === "error") {
        setError(result.message);
      }
    });
  };

  const handleValidate = () => {
    if (!rewriteData) return;
    setError(null);
    startValidate(async () => {
      const result = await runValidationAction(
        candidate.sampleQueryText,
        rewriteData.rewrittenSql,
        iterations
      );
      if (result.status === "success") {
        setValidation(result.summary);
      } else {
        setError(result.message);
      }
    });
  };

  const handleSave = () => {
    if (!rewriteData) return;
    startSave(async () => {
      const id = `rec_${candidate.fingerprint}_${Date.now()}`;
      const result = await saveRecommendationAction({
        id,
        fingerprint: candidate.fingerprint,
        originalSql: candidate.sampleQueryText,
        rewrittenSql: rewriteData.rewrittenSql,
        rationale: rewriteData.rationale,
        risks: JSON.stringify(rewriteData.risks),
        validationPlan: JSON.stringify(rewriteData.validationPlan),
        status: validation ? "validated" : "draft",
        impactScore: candidate.impactScore,
        warehouseName: candidate.warehouseName,
        warehouseId: candidate.warehouseId,
        createdBy: "system",
        validationResults: validation ? JSON.stringify(validation) : null,
        speedupPct: validation?.speedupPct ?? null,
        rowCountMatch: validation?.rowCountMatch ?? null,
      });
      if (result.status === "success") {
        setSaved(true);
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Validation Benchmark
          </h1>
          <p className="text-sm text-muted-foreground">
            Impact Score: {candidate.impactScore} &middot;{" "}
            {candidate.statementType} &middot; {candidate.warehouseName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!rewriteData && (
            <Button onClick={handleGenerate} disabled={rewriting}>
              {rewriting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1.5" />
              )}
              {rewriting ? "Generating\u2026" : "Generate Rewrite First"}
            </Button>
          )}
          {rewriteData && !validation && (
            <div className="flex items-center gap-2">
              <select
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value={1}>1 run</option>
                <option value={3}>3 runs</option>
                <option value={5}>5 runs</option>
              </select>
              <Button onClick={handleValidate} disabled={validating}>
                {validating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Play className="h-4 w-4 mr-1.5" />
                )}
                {validating ? "Running\u2026" : "Run Validation"}
              </Button>
            </div>
          )}
          {validation && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving || saved}
              >
                {saved ? (
                  <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                ) : saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Save className="h-4 w-4 mr-1.5" />
                )}
                {saved ? "Saved" : saving ? "Saving\u2026" : "Save Recommendation"}
              </Button>
              <Link href="/recommendations">
                <Button className="gap-1.5">
                  View All
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Validation Results */}
      {validation && (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="py-4">
              <CardContent className="flex items-start gap-3">
                <Timer className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Baseline Avg</p>
                  <p className="text-xl font-bold tabular-nums">
                    {formatDuration(validation.baselineAvgMs)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="flex items-start gap-3">
                <Timer className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Rewrite Avg</p>
                  <p className="text-xl font-bold tabular-nums">
                    {formatDuration(validation.rewriteAvgMs)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card
              className={`py-4 ${validation.speedupPct > 0 ? "border-emerald-200 dark:border-emerald-800" : validation.speedupPct < 0 ? "border-red-200 dark:border-red-800" : ""}`}
            >
              <CardContent className="flex items-start gap-3">
                {validation.speedupPct > 0 ? (
                  <TrendingUp className="h-5 w-5 text-emerald-500 mt-0.5" />
                ) : validation.speedupPct < 0 ? (
                  <TrendingDown className="h-5 w-5 text-red-500 mt-0.5" />
                ) : (
                  <Minus className="h-5 w-5 text-muted-foreground mt-0.5" />
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Speedup</p>
                  <p
                    className={`text-xl font-bold tabular-nums ${
                      validation.speedupPct > 0
                        ? "text-emerald-600"
                        : validation.speedupPct < 0
                          ? "text-red-600"
                          : ""
                    }`}
                  >
                    {validation.speedupPct > 0 ? "+" : ""}
                    {validation.speedupPct}%
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="flex items-start gap-3">
                {validation.rowCountMatch ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Row Count</p>
                  <p className="text-xl font-bold">
                    {validation.rowCountMatch ? "Match" : "Mismatch!"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {validation.baselineAvgRows} vs {validation.rewriteAvgRows}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Individual runs */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Baseline Runs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {validation.baselineRuns.map((run, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground w-8">
                        #{i + 1}
                      </span>
                      {run.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="tabular-nums font-medium">
                        {formatDuration(run.durationMs)}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {run.rowCount} rows
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Rewrite Runs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {validation.rewriteRuns.map((run, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground w-8">
                        #{i + 1}
                      </span>
                      {run.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="tabular-nums font-medium">
                        {formatDuration(run.durationMs)}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {run.rowCount} rows
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Waiting state */}
      {validating && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <p className="text-sm font-medium">
              Running validation benchmark\u2026
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Executing baseline and rewrite {iterations} times each
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pre-rewrite state */}
      {!rewriteData && !rewriting && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Sparkles className="h-10 w-10 mb-4 opacity-30" />
            <p className="text-sm">
              Generate an AI rewrite first, then run the validation benchmark.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
