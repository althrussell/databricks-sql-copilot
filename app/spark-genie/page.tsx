"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldAlert, Wrench, AlertTriangle, XCircle } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  sqlColumns?: string[];
  sqlRows?: unknown[][];
  status?: string;
}

interface GenieErrorInfo {
  error: string;
  code?: string;
  fixSteps?: string[];
}

const SAMPLE_QUESTIONS = [
  "What are the slowest SQL queries in the last 24 hours?",
  "Which warehouses have the highest p95 query duration this week?",
  "Show top 20 failed queries by total duration impact",
  "Which users ran the most failed queries in the last 7 days?",
  "Show query status distribution by warehouse for the last 30 days",
  "Find queries with high compilation time compared to execution time",
  "Which query sources (dashboards/jobs/notebooks) generate the most query volume?",
  "Show warehouses with highest spill bytes and highest read bytes",
  "Estimate daily cost by warehouse for the last 14 days",
  "Which users or workloads are driving the highest DBU usage?",
  "Show week-over-week cost growth by workspace",
  "Which warehouses are most expensive per successful query?",
  "Compare Serverless vs Pro warehouse cost trends over time",
  "Which clusters are created most frequently by owner this month?",
  "Show cluster inventory by DBR version and node type",
  "Find clusters with high worker counts and short lifetimes",
  "Which clusters changed configuration most frequently?",
  "Show top warehouses by queued query pressure indicators",
  "Correlate query failures with warehouse and cluster changes",
  "Summarize observability and cost anomalies for the last 7 days",
];

function formatCellValue(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "number") {
    if (Number.isInteger(val) && Math.abs(val) > 10_000) {
      return val.toLocaleString();
    }
    if (!Number.isInteger(val)) {
      return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
  }
  return String(val);
}

function RichText({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="text-sm font-semibold mt-3 mb-1">
          {renderInline(line.slice(4))}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="text-base font-semibold mt-3 mb-1.5">
          {renderInline(line.slice(3))}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h2 key={i} className="text-lg font-bold mt-3 mb-2 border-b border-border/30 pb-1">
          {renderInline(line.slice(2))}
        </h2>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-2 ml-2 text-sm leading-relaxed">
          <span className="text-muted-foreground shrink-0">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 ml-2 text-sm leading-relaxed">
            <span className="text-muted-foreground shrink-0 tabular-nums">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>,
        );
      }
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="bg-background/60 border border-border/30 rounded px-1 py-0.5 text-xs font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function SparkGeniePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<GenieErrorInfo | null>(null);
  const [showSql, setShowSql] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const pollForResponse = useCallback(async (convId: string, msgId: string) => {
    const maxPolls = 30;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch("/api/spark-genie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll", conversationId: convId, messageId: msgId }),
      });
      const pollData = await pollRes.json();
      if (pollData.error) {
        const genieErr: GenieErrorInfo = {
          error: pollData.error,
          code: pollData.code,
          fixSteps: pollData.fixSteps,
        };
        throw Object.assign(new Error(pollData.error), { genieError: genieErr });
      }

      if (pollData.status === "COMPLETED") {
        let sqlColumns: string[] = [];
        let sqlRows: unknown[][] = [];
        if (pollData.sql) {
          try {
            const qrRes = await fetch("/api/spark-genie", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "query-result",
                conversationId: convId,
                messageId: msgId,
              }),
            });
            const qr = await qrRes.json();
            sqlColumns = qr.columns ?? [];
            sqlRows = qr.rows ?? [];
          } catch {
            /* ignore */
          }
        }
        return { content: pollData.content, sql: pollData.sql, sqlColumns, sqlRows };
      }

      if (pollData.status === "FAILED") {
        throw new Error(pollData.content || "Genie query failed");
      }

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.status === "thinking") {
          return [...prev.slice(0, -1), { ...last, content: pollData.content || "Thinking..." }];
        }
        return prev;
      });
    }
    throw new Error("Genie response timed out");
  }, []);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || loading) return;
      setError(null);
      setLoading(true);

      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: question };
      const thinkingMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: "Analyzing your data...",
        status: "thinking",
      };
      setMessages((prev) => [...prev, userMsg, thinkingMsg]);
      setInput("");

      try {
        let convId = conversationId;
        let msgId: string;

        if (!convId) {
          const res = await fetch("/api/spark-genie", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ask", question }),
          });
          const data = await res.json();
          if (data.error) {
            const genieErr: GenieErrorInfo = {
              error: data.error,
              code: data.code,
              fixSteps: data.fixSteps,
            };
            throw Object.assign(new Error(data.error), { genieError: genieErr });
          }
          convId = data.conversationId;
          msgId = data.messageId;
          setConversationId(convId);
        } else {
          const res = await fetch("/api/spark-genie", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "continue", conversationId: convId, question }),
          });
          const data = await res.json();
          if (data.error) {
            const genieErr: GenieErrorInfo = {
              error: data.error,
              code: data.code,
              fixSteps: data.fixSteps,
            };
            throw Object.assign(new Error(data.error), { genieError: genieErr });
          }
          msgId = data.messageId;
        }

        const result = await pollForResponse(convId!, msgId);

        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: result.content,
            sql: result.sql,
            sqlColumns: result.sqlColumns,
            sqlRows: result.sqlRows,
          },
        ]);
      } catch (err: unknown) {
        const e = err as { genieError?: GenieErrorInfo; message?: string };
        if (e.genieError) {
          setError(e.genieError);
        } else {
          setError({ error: e.message ?? String(err) });
        }
        setMessages((prev) => prev.filter((m) => m.status !== "thinking"));
      } finally {
        setLoading(false);
      }
    },
    [loading, conversationId, pollForResponse],
  );

  const hasResults = (msg: Message) =>
    msg.sqlColumns && msg.sqlColumns.length > 0 && msg.sqlRows && msg.sqlRows.length > 0;

  return (
    <div className="px-6 py-8 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SQL Observability & Monitoring Genie</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask natural language questions over query history, warehouse health, cluster inventory,
          and billing system tables.
        </p>
      </div>

      {messages.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sample Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  className="text-left text-sm px-3 py-2.5 rounded-lg border hover:bg-muted/50 transition-colors"
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                >
                  {q}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "user" ? (
              <div className="max-w-[75%] rounded-lg px-4 py-2.5 bg-primary text-primary-foreground">
                <p className="text-sm">{msg.content}</p>
              </div>
            ) : msg.status === "thinking" ? (
              <Card className="max-w-[85%] border-border/50">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span
                        className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{msg.content}</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="max-w-[90%] border-border/50">
                <CardContent className="pt-4 pb-3 px-5 space-y-3">
                  {msg.content && <RichText text={msg.content} />}

                  {msg.sql && (
                    <div>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                        onClick={() => setShowSql((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                      >
                        <span>{showSql[msg.id] ? "▾" : "▸"}</span>
                        <span>SQL Query</span>
                      </button>
                      {showSql[msg.id] && (
                        <pre className="mt-1.5 text-xs bg-background/60 border border-border/30 rounded-md p-3 overflow-x-auto font-mono text-muted-foreground">
                          {msg.sql}
                        </pre>
                      )}
                    </div>
                  )}

                  {hasResults(msg) && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {msg.sqlRows!.length} row{msg.sqlRows!.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      <div className="overflow-x-auto rounded-md border border-border/40">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              {msg.sqlColumns!.map((col) => (
                                <TableHead
                                  key={col}
                                  className="text-xs font-semibold whitespace-nowrap px-3 py-2"
                                >
                                  {col.replace(/_/g, " ")}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {msg.sqlRows!.slice(0, 25).map((row, ri) => (
                              <TableRow key={ri} className="hover:bg-muted/20">
                                {(row as unknown[]).map((cell, ci) => (
                                  <TableCell
                                    key={ci}
                                    className="text-xs px-3 py-1.5 whitespace-nowrap tabular-nums"
                                  >
                                    {formatCellValue(cell)}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {msg.sqlRows!.length > 25 && (
                        <p className="text-xs text-muted-foreground">
                          Showing 25 of {msg.sqlRows!.length} rows
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-2 mt-0.5 shrink-0">
                {error.code === "GENIE_SPACE_NOT_FOUND" ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : error.code === "WAREHOUSE_PERMISSION_DENIED" ||
                  error.code === "PERMISSION_DENIED" ||
                  error.code === "MISSING_OAUTH_SCOPE" ? (
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
              <div className="space-y-2 min-w-0">
                <div>
                  {error.code && (
                    <Badge
                      variant="outline"
                      className="text-[10px] mb-1 text-destructive border-destructive/30"
                    >
                      {error.code}
                    </Badge>
                  )}
                  <p className="text-sm font-medium text-destructive">{error.error}</p>
                </div>
                {error.fixSteps && error.fixSteps.length > 0 && (
                  <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Wrench className="h-3.5 w-3.5" />
                      How to fix
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                      {error.fixSteps.map((step, i) => (
                        <li key={i} className="leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <input
          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
          placeholder="Ask a question about query performance, warehouse health, cost, or clusters..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
          disabled={loading}
        />
        <button
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : "Send"}
        </button>
        {conversationId && (
          <button
            className="h-10 px-3 rounded-md border text-sm hover:bg-muted/50"
            onClick={() => {
              setConversationId(null);
              setMessages([]);
              setError(null);
            }}
          >
            New Chat
          </button>
        )}
      </div>
    </div>
  );
}
