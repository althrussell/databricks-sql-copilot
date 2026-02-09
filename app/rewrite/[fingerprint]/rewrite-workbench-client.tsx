"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
  ChevronRight,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rewriteQuery } from "@/lib/ai/actions";
import type { Candidate } from "@/lib/domain/types";
import type { RewriteResponse } from "@/lib/ai/promptBuilder";
import type { AiResult } from "@/lib/ai/aiClient";

interface RewriteWorkbenchProps {
  candidate: Candidate;
  workspaceUrl: string;
}

export function RewriteWorkbenchClient({
  candidate,
  workspaceUrl,
}: RewriteWorkbenchProps) {
  const [rewriting, startRewrite] = useTransition();
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedRewrite, setCopiedRewrite] = useState(false);

  const rewriteData =
    aiResult?.status === "success" && aiResult.mode === "rewrite"
      ? (aiResult.data as RewriteResponse)
      : null;

  const handleGenerate = () => {
    startRewrite(async () => {
      const result = await rewriteQuery(candidate);
      setAiResult(result);
    });
  };

  const handleCopy = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Rewrite Workbench
          </h1>
          <p className="text-sm text-muted-foreground">
            Impact Score: {candidate.impactScore} &middot;{" "}
            {candidate.statementType} &middot; {candidate.warehouseName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!rewriteData && (
            <Button
              onClick={handleGenerate}
              disabled={rewriting}
              className="gap-1.5"
            >
              {rewriting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {rewriting ? "Generating\u2026" : "Generate Rewrite"}
            </Button>
          )}
          {rewriteData && (
            <Link href={`/validate/${candidate.fingerprint}`}>
              <Button className="gap-1.5">
                Validate
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Error states */}
      {aiResult?.status === "error" && (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300 text-sm">
                Rewrite Failed
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {aiResult.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleGenerate}
                disabled={rewriting}
              >
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {aiResult?.status === "guardrail" && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-amber-700 dark:text-amber-300 text-sm">
                Guardrail Triggered
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {aiResult.message}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Side-by-side diff view */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Original SQL */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Original SQL</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleCopy(candidate.sampleQueryText, setCopiedOriginal)
                }
                className="h-7 px-2 text-xs gap-1.5"
              >
                {copiedOriginal ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copiedOriginal ? "Copied" : "Copy"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted/50 border border-border p-4 min-h-[200px] max-h-[500px] overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                {candidate.sampleQueryText}
              </pre>
            </div>
          </CardContent>
        </Card>

        {/* Rewritten SQL */}
        <Card
          className={
            rewriteData
              ? "border-primary/30"
              : "border-dashed border-muted-foreground/20"
          }
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Rewritten SQL
              </CardTitle>
              {rewriteData && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleCopy(rewriteData.rewrittenSql, setCopiedRewrite)
                  }
                  className="h-7 px-2 text-xs gap-1.5"
                >
                  {copiedRewrite ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedRewrite ? "Copied" : "Copy"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {rewriteData ? (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 min-h-[200px] max-h-[500px] overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/90">
                  {rewriteData.rewrittenSql}
                </pre>
              </div>
            ) : rewriting ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-sm">Generating optimized SQL\u2026</p>
                <p className="text-xs mt-1">This may take 10-30 seconds</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                <Sparkles className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">
                  Click &quot;Generate Rewrite&quot; to get an AI-optimized
                  version
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rewrite details (if available) */}
      {rewriteData && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Rationale */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Rationale</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {rewriteData.rationale}
              </p>
            </CardContent>
          </Card>

          {/* Risks */}
          <Card className="border-amber-200/50 dark:border-amber-800/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                Risks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rewriteData.risks.map((r, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-amber-200 dark:border-amber-800 p-2.5 space-y-1"
                >
                  <p className="text-xs font-medium">{r.risk}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.mitigation}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Validation Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Validation Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rewriteData.validationPlan.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-xs font-bold tabular-nums text-primary mt-0.5 w-5 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
