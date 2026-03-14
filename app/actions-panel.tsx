"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Code,
  DollarSign,
  Loader2,
  Search,
  Sparkles,
  User,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ActionItem, ActionsSummaryResult } from "@/lib/ai/actions-summary";

const CATEGORY_CONFIG: Record<string, { label: string; cls: string; icon: typeof Wrench }> = {
  "query-optimization": {
    label: "Query",
    cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Search,
  },
  "table-optimization": {
    label: "Table",
    cls: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    icon: Zap,
  },
  "job-reliability": {
    label: "Reliability",
    cls: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    icon: AlertTriangle,
  },
  "job-performance": {
    label: "Performance",
    cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    icon: Zap,
  },
  "cost-reduction": {
    label: "Cost",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: DollarSign,
  },
  "user-outreach": {
    label: "Outreach",
    cls: "bg-pink-500/10 text-pink-400 border-pink-500/20",
    icon: User,
  },
};

const EFFORT_CONFIG: Record<string, { label: string; cls: string }> = {
  "quick-win": {
    label: "Quick win",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  medium: { label: "Medium", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  project: { label: "Project", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
};

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 relative group">
      <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-md px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-muted-foreground">
        {command}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-background/80 border border-border hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <ClipboardCopy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

function ActionRow({
  item,
  expanded,
  onToggle,
}: {
  item: ActionItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cat = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG["query-optimization"];
  const eff = EFFORT_CONFIG[item.effort] ?? EFFORT_CONFIG["medium"];
  const CatIcon = cat.icon;

  return (
    <div
      className={`border border-border/50 rounded-lg transition-colors ${expanded ? "bg-muted/20" : "hover:bg-muted/10"}`}
    >
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-start gap-3">
        <span
          className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0 mt-0.5 ${
            item.priority <= 3
              ? "bg-red-500/20 text-red-400"
              : item.priority <= 6
                ? "bg-orange-500/20 text-orange-400"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {item.priority}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{item.action}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className={`text-[9px] ${cat.cls}`}>
              <CatIcon className="h-2.5 w-2.5 mr-0.5" />
              {cat.label}
            </Badge>
            <Badge variant="outline" className={`text-[9px] ${eff.cls}`}>
              {eff.label}
            </Badge>
            {item.owner && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <User className="h-2.5 w-2.5" />
                {item.owner}
              </span>
            )}
            {item.target && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                {item.target}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 mt-1">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-13 space-y-2 border-t border-border/30 pt-2 ml-9">
          <div className="flex items-start gap-2">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">{item.impact}</p>
          </div>
          {item.command && (
            <div className="flex items-start gap-2">
              <Code className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground mb-0.5">Run this command:</p>
                <CommandBlock command={item.command} />
              </div>
            </div>
          )}
          {!item.command && item.category === "user-outreach" && (
            <div className="flex items-start gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-pink-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Reach out to <span className="font-medium text-foreground">{item.owner}</span> about
                this issue.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ActionsPanelProps {
  startTime: string;
  endTime: string;
}

export function ActionsPanel({ startTime, endTime }: ActionsPanelProps) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<ActionsSummaryResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  async function generate() {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/actions-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime, endTime }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: ActionsSummaryResult = await res.json();
      setResult(data);
      setState("success");
      setExpandedIdx(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Operator Actions Summary</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Analyses SQL queries, jobs, and table scan patterns to generate 10 prioritised,
              actionable recommendations. Includes runnable commands, cost estimates, and specific
              people to contact.
            </p>
          </div>
          <Button onClick={generate} size="sm" className="gap-2 mt-1">
            <Bot className="h-3.5 w-3.5" />
            Generate Action Items
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">Generating operator actions…</p>
            <p className="text-xs text-muted-foreground mt-1">
              Scanning SQL queries, job failures, and table hotspots to build your top-10 action
              list.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card className="border-l-4 border-l-red-500 bg-red-500/5">
        <CardContent className="py-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-400">Failed to generate actions</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setState("idle")}
            >
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result || result.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No actionable items found for this window. Try a wider time range.
          </p>
        </CardContent>
      </Card>
    );
  }

  const quickWins = result.items.filter((i) => i.effort === "quick-win").length;
  const categories = [...new Set(result.items.map((i) => i.category))];

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Operator Actions
              <Badge variant="secondary" className="text-[10px]">
                {result.items.length} items
              </Badge>
              {quickWins > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                >
                  {quickWins} quick wins
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {categories.length} categories · generated{" "}
                {new Date(result.generatedAt).toLocaleTimeString("en", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={() => {
                  setState("idle");
                  setResult(null);
                }}
              >
                <Sparkles className="h-3 w-3" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {result.items.map((item, idx) => (
            <ActionRow
              key={idx}
              item={item}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            />
          ))}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
