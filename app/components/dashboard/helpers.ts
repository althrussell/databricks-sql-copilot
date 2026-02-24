"use client";

import type { QueryOrigin } from "@/lib/domain/types";
import { format } from "date-fns";
import {
  LayoutDashboard,
  FileCode2,
  BriefcaseBusiness,
  Bell,
  Terminal,
  Bot,
  HelpCircle,
} from "lucide-react";

export type QueryActionType = "dismiss" | "watch" | "applied";
export interface QueryActionEntry {
  action: QueryActionType;
  note: string | null;
  actedBy: string | null;
  actedAt: string;
}

export interface DataSourceHealth {
  name: string;
  status: "ok" | "error";
  error?: string;
  rowCount: number;
}

export const BILLING_LAG_HOURS = 6;

export const TIME_PRESETS = [
  { label: "1 hour", value: "1h" },
  { label: "6 hours", value: "6h" },
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
] as const;

export function describeWindow(preset: string): string {
  const knownHours: Record<string, number> = {
    "1h": 1, "6h": 6, "24h": 24, "7d": 168,
  };
  let hrs = knownHours[preset];
  if (hrs === undefined) {
    const match = preset.match(/^(\d+)h$/);
    hrs = match ? parseInt(match[1], 10) : 1;
  }
  const endAgo = BILLING_LAG_HOURS;
  const startAgo = endAgo + hrs;
  if (startAgo <= 48) {
    return `${startAgo}h ago → ${endAgo}h ago`;
  }
  const startDays = Math.round(startAgo / 24);
  return `~${startDays}d ago → ${endAgo}h ago`;
}

export function formatCustomRangeLabel(range: { from: string; to: string }): string {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const sameDay =
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate();
  if (sameDay) {
    return `${format(from, "MMM d")} ${format(from, "HH:mm")} \u2013 ${format(to, "HH:mm")}`;
  }
  return `${format(from, "MMM d, HH:mm")} \u2013 ${format(to, "MMM d, HH:mm")}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function truncateQuery(text: string, maxLen = 60): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen
    ? cleaned.slice(0, maxLen) + "\u2026"
    : cleaned;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function formatDBUs(dbus: number): string {
  if (dbus >= 1_000) return `${(dbus / 1_000).toFixed(1)}k`;
  if (dbus >= 1) return dbus.toFixed(1);
  return dbus.toFixed(2);
}

export function formatDollars(dollars: number): string {
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars > 0) return `$${dollars.toFixed(3)}`;
  return "$0";
}

export function timeAgo(isoTime: string): string {
  const diff = Date.now() - new Date(isoTime).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function buildLink(
  base: string,
  type: string,
  id: string | null | undefined,
  extras?: { queryStartTimeMs?: number }
): string | null {
  if (!id || !base) return null;
  switch (type) {
    case "query-profile": {
      const params = new URLSearchParams({ queryId: id });
      if (extras?.queryStartTimeMs) {
        params.set("queryStartTimeMs", String(extras.queryStartTimeMs));
      }
      return `${base}/sql/history?${params.toString()}`;
    }
    case "warehouse":
      return `${base}/sql/warehouses/${id}`;
    case "dashboard":
      return `${base}/sql/dashboardsv3/${id}`;
    case "legacy-dashboard":
      return `${base}/sql/dashboards/${id}`;
    case "notebook":
      return `${base}/editor/notebooks/${id}`;
    case "job":
      return `${base}/jobs/${id}`;
    case "alert":
      return `${base}/sql/alerts/${id}`;
    case "sql-query":
      return `${base}/sql/queries/${id}`;
    case "genie":
      return `${base}/genie/rooms/${id}`;
    default:
      return null;
  }
}

export function scoreColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-emerald-500";
}

export function scoreTextColor(score: number): string {
  if (score >= 70) return "text-red-600 dark:text-red-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export function flagSeverityColor(severity: "warning" | "critical"): string {
  if (severity === "critical")
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
}

export function tagToStatus(
  tag: string
): "default" | "warning" | "error" | "info" | "cached" {
  switch (tag) {
    case "slow":
      return "error";
    case "high-spill":
      return "warning";
    case "capacity-bound":
      return "warning";
    case "frequent":
      return "info";
    case "mostly-cached":
      return "cached";
    case "quick-win":
      return "info";
    default:
      return "default";
  }
}

export function originIcon(origin: QueryOrigin) {
  switch (origin) {
    case "dashboard":
      return LayoutDashboard;
    case "notebook":
      return FileCode2;
    case "job":
      return BriefcaseBusiness;
    case "alert":
      return Bell;
    case "sql-editor":
      return Terminal;
    case "genie":
      return Bot;
    default:
      return HelpCircle;
  }
}

export function originLabel(origin: QueryOrigin): string {
  switch (origin) {
    case "dashboard":
      return "Dashboard";
    case "notebook":
      return "Notebook";
    case "job":
      return "Job";
    case "alert":
      return "Alert";
    case "sql-editor":
      return "SQL Editor";
    case "genie":
      return "Genie";
    default:
      return "Unknown";
  }
}

export const TRIAGE_ACTION_STYLE: Record<string, string> = {
  rewrite: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  cluster: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  optimize: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  resize: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  investigate: "bg-muted text-muted-foreground border-border",
};

export const TIME_SEGMENT_COLORS = [
  { key: "compilation", color: "bg-blue-400 dark:bg-blue-600", label: "Compile" },
  { key: "queue", color: "bg-amber-400 dark:bg-amber-600", label: "Queue" },
  { key: "compute", color: "bg-purple-400 dark:bg-purple-600", label: "Compute Wait" },
  { key: "execution", color: "bg-emerald-400 dark:bg-emerald-600", label: "Execute" },
  { key: "fetch", color: "bg-rose-400 dark:bg-rose-600", label: "Fetch" },
];
