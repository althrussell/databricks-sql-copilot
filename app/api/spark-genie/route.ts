import { NextRequest, NextResponse } from "next/server";
import {
  startGenieConversation,
  continueGenieConversation,
  pollGenieMessage,
  getGenieQueryResult,
  GenieApiError,
} from "@/lib/queries/genie-client";
import { SparkGenieBodySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const GENIE_SPACE_ID = process.env.GENIE_SPACE_ID ?? "";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = SparkGenieBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }
    const { action, question, conversationId, messageId } = parsed.data;

    const sid = GENIE_SPACE_ID;
    if (!sid) {
      return NextResponse.json(
        {
          error: "Genie Space is not configured.",
          code: "GENIE_NOT_CONFIGURED",
          fixSteps: [
            "Create a Genie Space in your Databricks workspace",
            "Set the GENIE_SPACE_ID environment variable in the app configuration (app.yaml or .env.local)",
            "Redeploy the app",
          ],
        },
        { status: 400 },
      );
    }

    switch (action) {
      case "ask": {
        if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
        const result = await startGenieConversation(sid, question);
        return NextResponse.json(result);
      }
      case "continue": {
        if (!conversationId || !question) {
          return NextResponse.json(
            { error: "conversationId and question required" },
            { status: 400 },
          );
        }
        const result = await continueGenieConversation(sid, conversationId, question);
        return NextResponse.json(result);
      }
      case "poll": {
        if (!conversationId || !messageId) {
          return NextResponse.json(
            { error: "conversationId and messageId required" },
            { status: 400 },
          );
        }
        const msg = await pollGenieMessage(sid, conversationId, messageId);
        return NextResponse.json(msg);
      }
      case "query-result": {
        if (!conversationId || !messageId) {
          return NextResponse.json(
            { error: "conversationId and messageId required" },
            { status: 400 },
          );
        }
        const qr = await getGenieQueryResult(sid, conversationId, messageId);
        return NextResponse.json(qr);
      }
    }
  } catch (err) {
    if (err instanceof GenieApiError) {
      const code = err.genieError.code;
      const status =
        code === "GENIE_SPACE_NOT_FOUND"
          ? 404
          : code === "PERMISSION_DENIED" ||
              code === "WAREHOUSE_PERMISSION_DENIED" ||
              code === "MISSING_OAUTH_SCOPE"
            ? 403
            : 502;
      return NextResponse.json(
        {
          error: err.genieError.message,
          code: err.genieError.code,
          fixSteps: err.genieError.fixSteps,
        },
        { status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
