import { NextRequest, NextResponse } from "next/server";
import {
  startGenieConversation,
  continueGenieConversation,
  pollGenieMessage,
  getGenieQueryResult,
  GenieApiError,
} from "@/lib/queries/genie-client";

export const dynamic = "force-dynamic";

const GENIE_SPACE_ID = process.env.GENIE_SPACE_ID ?? "";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, question, conversationId, messageId } = body as {
      action: "ask" | "continue" | "poll" | "query-result";
      question?: string;
      conversationId?: string;
      messageId?: string;
    };

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
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof GenieApiError) {
      return NextResponse.json(
        {
          error: err.genieError.message,
          code: err.genieError.code,
          fixSteps: err.genieError.fixSteps,
        },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
