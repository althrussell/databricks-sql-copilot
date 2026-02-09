"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  TrendingDown,
  Minus,
  FileDown,
  Loader2,
  FileText,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  updateRecommendationAction,
  deleteRecommendationAction,
  type Recommendation,
  type RecommendationStatus,
} from "@/lib/dbx/actions";

interface RecommendationsClientProps {
  initialRecommendations: Recommendation[];
}

function statusColor(status: RecommendationStatus) {
  switch (status) {
    case "draft":
      return "bg-muted text-muted-foreground";
    case "validated":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "approved":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "rejected":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    case "applied":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function statusIcon(status: RecommendationStatus) {
  switch (status) {
    case "draft":
      return Clock;
    case "validated":
      return Sparkles;
    case "approved":
      return CheckCircle2;
    case "rejected":
      return XCircle;
    case "applied":
      return CheckCircle2;
    default:
      return Clock;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function truncateQuery(text: string, maxLen = 80): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen
    ? cleaned.slice(0, maxLen) + "\u2026"
    : cleaned;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function RecommendationsClient({
  initialRecommendations,
}: RecommendationsClientProps) {
  const [recommendations, setRecommendations] = useState(
    initialRecommendations
  );
  const [operating, startOperation] = useTransition();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered =
    statusFilter === "all"
      ? recommendations
      : recommendations.filter((r) => r.status === statusFilter);

  // KPIs
  const totalCount = recommendations.length;
  const approvedCount = recommendations.filter(
    (r) => r.status === "approved"
  ).length;
  const validatedCount = recommendations.filter(
    (r) => r.status === "validated"
  ).length;
  const avgSpeedup =
    recommendations.filter((r) => r.speedupPct != null).length > 0
      ? Math.round(
          recommendations
            .filter((r) => r.speedupPct != null)
            .reduce((s, r) => s + (r.speedupPct ?? 0), 0) /
            recommendations.filter((r) => r.speedupPct != null).length
        )
      : 0;

  const handleStatusChange = (id: string, status: RecommendationStatus) => {
    startOperation(async () => {
      const result = await updateRecommendationAction(id, { status });
      if (result.status === "success") {
        setRecommendations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status } : r))
        );
      }
    });
  };

  const handleDelete = (id: string) => {
    startOperation(async () => {
      const result = await deleteRecommendationAction(id);
      if (result.status === "success") {
        setRecommendations((prev) => prev.filter((r) => r.id !== id));
      }
    });
  };

  const handleExportJson = () => {
    const data = JSON.stringify(recommendations, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recommendations_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const headers = [
      "id",
      "fingerprint",
      "status",
      "impact_score",
      "speedup_pct",
      "row_count_match",
      "warehouse_name",
      "created_at",
      "rationale",
    ];
    const rows = recommendations.map((r) => [
      r.id,
      r.fingerprint,
      r.status,
      r.impactScore,
      r.speedupPct ?? "",
      r.rowCountMatch ?? "",
      r.warehouseName,
      r.createdAt,
      `"${r.rationale.replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recommendations_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Recommendation Backlog
            </h1>
            <p className="text-sm text-muted-foreground">
              AI-generated rewrites with validation results
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="gap-1.5"
            >
              <FileDown className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJson}
              className="gap-1.5"
            >
              <FileText className="h-3.5 w-3.5" />
              JSON
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="py-4">
            <CardContent className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-bold tabular-nums">{totalCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Approved</p>
                <p className="text-2xl font-bold tabular-nums">
                  {approvedCount}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-blue-500 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Validated</p>
                <p className="text-2xl font-bold tabular-nums">
                  {validatedCount}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex items-start gap-3">
              {avgSpeedup > 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-500 mt-0.5" />
              ) : (
                <Minus className="h-5 w-5 text-muted-foreground mt-0.5" />
              )}
              <div>
                <p className="text-xs text-muted-foreground">Avg Speedup</p>
                <p className="text-2xl font-bold tabular-nums">
                  {avgSpeedup > 0 ? `+${avgSpeedup}%` : "\u2014"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          {["all", "draft", "validated", "approved", "rejected"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className="capitalize text-xs"
            >
              {s === "all" ? `All (${totalCount})` : s}
            </Button>
          ))}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-4 opacity-30" />
              <p className="text-base font-semibold">No recommendations yet</p>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                Generate AI rewrites from the query detail page, validate them,
                and save to build your recommendation backlog.
              </p>
              <Button className="mt-6" asChild>
                <Link href="/">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[30%]">Query</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Impact</TableHead>
                    <TableHead className="text-right">Speedup</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((rec) => {
                    const StatusIcon = statusIcon(rec.status);
                    return (
                      <TableRow key={rec.id}>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColor(rec.status)}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {rec.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-mono text-xs cursor-help">
                                {truncateQuery(rec.originalSql)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="bottom"
                              className="max-w-lg"
                            >
                              <pre className="text-xs whitespace-pre-wrap">
                                {rec.originalSql.slice(0, 500)}
                              </pre>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-sm">
                          {rec.warehouseName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {rec.impactScore}
                        </TableCell>
                        <TableCell className="text-right">
                          {rec.speedupPct != null ? (
                            <span
                              className={`tabular-nums font-medium ${
                                rec.speedupPct > 0
                                  ? "text-emerald-600"
                                  : rec.speedupPct < 0
                                    ? "text-red-600"
                                    : ""
                              }`}
                            >
                              {rec.speedupPct > 0 ? "+" : ""}
                              {rec.speedupPct}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              \u2014
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {rec.rowCountMatch != null ? (
                            rec.rowCountMatch ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-500" />
                            )
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              \u2014
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatTimestamp(rec.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {rec.status !== "approved" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    disabled={operating}
                                    onClick={() =>
                                      handleStatusChange(rec.id, "approved")
                                    }
                                  >
                                    <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Approve</TooltipContent>
                              </Tooltip>
                            )}
                            {rec.status !== "rejected" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    disabled={operating}
                                    onClick={() =>
                                      handleStatusChange(rec.id, "rejected")
                                    }
                                  >
                                    <ThumbsDown className="h-3.5 w-3.5 text-red-600" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reject</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  disabled={operating}
                                  onClick={() => handleDelete(rec.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
