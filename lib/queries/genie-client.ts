import { getConfig } from "@/lib/config";
import { fetchWithTimeout, TIMEOUTS } from "@/lib/dbx/fetch-with-timeout";

/**
 * Always use the app service principal's all-apis token for Genie calls.
 * The OBO user token's `dashboards.genie` scope is not accepted by the
 * Genie Conversation API (it requires the literal `genie` scope which
 * cannot be requested through the Apps scope picker). The SP token with
 * `all-apis` works reliably — the SP just needs `Can Run` on the space.
 */
async function getSpBearerToken(): Promise<string> {
  const config = getConfig();
  if (config.auth.mode === "pat") return config.auth.token;

  if (config.auth.mode !== "oauth") {
    throw new Error("Genie client requires OAuth (SP) or PAT credentials.");
  }

  const tokenUrl = `https://${config.serverHostname}/oidc/v1/token`;
  const body = new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" });
  const credentials = btoa(`${config.auth.clientId}:${config.auth.clientSecret}`);
  const response = await fetchWithTimeout(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    },
    { timeoutMs: TIMEOUTS.AUTH },
  );
  if (!response.ok) throw new Error("Genie SP OAuth failed: " + response.status);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export interface GenieError {
  code: string;
  message: string;
  fixSteps: string[];
}

function parseGenieError(status: number, body: string, context: string): GenieError {
  let parsed: { error_code?: string; message?: string } = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* raw text */
  }

  const errorCode = parsed.error_code ?? String(status);
  const rawMsg = parsed.message ?? body;
  const config = getConfig();
  const spId =
    config.auth.mode === "oauth" ? config.auth.clientId : "your-app-service-principal-id";

  if (
    status === 404 &&
    (errorCode === "RESOURCE_DOES_NOT_EXIST" || rawMsg.includes("does not exist"))
  ) {
    return {
      code: "GENIE_SPACE_NOT_FOUND",
      message: `The Genie Space does not exist or the app's Service Principal does not have access.`,
      fixSteps: [
        `Open Databricks workspace → navigate to the Genie Space`,
        `Click the Share button on the Genie Space`,
        `Add the app's Service Principal (ID: ${spId}) with "Can Run" permission`,
        `If the space was deleted, create a new one and update the GENIE_SPACE_ID environment variable`,
      ],
    };
  }

  if (status === 403) {
    if (
      rawMsg.includes("not authorized to use or monitor this SQL Endpoint") ||
      rawMsg.includes("SQL Endpoint")
    ) {
      return {
        code: "WAREHOUSE_PERMISSION_DENIED",
        message: `The app's Service Principal cannot access the SQL warehouse used by this Genie Space.`,
        fixSteps: [
          `Open Databricks workspace → SQL Warehouses`,
          `Click the warehouse used by the Genie Space`,
          `Go to Permissions tab`,
          `Add the app's Service Principal (ID: ${spId}) with "Can use" permission`,
          `Wait ~30 seconds for permissions to propagate, then retry`,
        ],
      };
    }

    if (rawMsg.includes("required scopes") || rawMsg.includes("Invalid scope")) {
      const scopeMatch = rawMsg.match(/required scopes?: (\w+)/);
      const missingScope = scopeMatch?.[1] ?? "genie / sql";
      return {
        code: "MISSING_OAUTH_SCOPE",
        message: `The app is missing the "${missingScope}" OAuth scope.`,
        fixSteps: [
          `Open Databricks workspace → Compute → Apps`,
          `Click on this app's name`,
          `Go to Permissions / OAuth Scopes`,
          `Add the following scopes: sql, dashboards.genie, serving.serving-endpoints`,
          `Save and wait for the app to restart`,
        ],
      };
    }

    return {
      code: "PERMISSION_DENIED",
      message: `Access denied during ${context}. The Service Principal lacks required permissions.`,
      fixSteps: [
        `Grant the app's Service Principal (ID: ${spId}) "Can Run" on the Genie Space`,
        `Grant "Can use" on the SQL warehouse used by the Genie Space`,
        `Ensure the app has the sql and dashboards.genie OAuth scopes`,
      ],
    };
  }

  return {
    code: errorCode,
    message: `Genie ${context} failed (${status}): ${rawMsg.slice(0, 300)}`,
    fixSteps: [],
  };
}

export class GenieApiError extends Error {
  public readonly genieError: GenieError;
  constructor(err: GenieError) {
    super(err.message);
    this.name = "GenieApiError";
    this.genieError = err;
  }
}

async function genieRequest(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  context: string,
): Promise<Response> {
  const res = await fetchWithTimeout(url, options, { timeoutMs });
  if (!res.ok) {
    const body = await res.text();
    const err = parseGenieError(res.status, body, context);
    throw new GenieApiError(err);
  }
  return res;
}

export interface GenieMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
  sql?: string;
  sqlResult?: unknown[][];
  sqlColumns?: string[];
  status: "COMPLETED" | "EXECUTING_QUERY" | "FILTERING_RESULTS" | "ASKING_AI" | "FAILED";
}

export async function startGenieConversation(
  spaceId: string,
  question: string,
): Promise<{ conversationId: string; messageId: string }> {
  const config = getConfig();
  const token = await getSpBearerToken();
  const url = `https://${config.serverHostname}/api/2.0/genie/spaces/${spaceId}/start-conversation`;
  const res = await genieRequest(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: question }),
      cache: "no-store",
    },
    60000,
    "starting conversation",
  );
  const data = (await res.json()) as { conversation_id: string; message_id: string };
  return { conversationId: data.conversation_id, messageId: data.message_id };
}

export async function continueGenieConversation(
  spaceId: string,
  conversationId: string,
  question: string,
): Promise<{ messageId: string }> {
  const config = getConfig();
  const token = await getSpBearerToken();
  const url = `https://${config.serverHostname}/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages`;
  const res = await genieRequest(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: question }),
      cache: "no-store",
    },
    60000,
    "continuing conversation",
  );
  const data = (await res.json()) as { id: string };
  return { messageId: data.id };
}

export async function pollGenieMessage(
  spaceId: string,
  conversationId: string,
  messageId: string,
): Promise<GenieMessage> {
  const config = getConfig();
  const token = await getSpBearerToken();
  const url = `https://${config.serverHostname}/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}`;
  const res = await genieRequest(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
    30000,
    "polling message",
  );
  const data = (await res.json()) as {
    id: string;
    status: string;
    attachments?: Array<{
      text?: { content: string };
      query?: { query: string; description: string };
    }>;
  };

  let content = "";
  let sql: string | undefined;
  const attachments = data.attachments ?? [];
  for (const att of attachments) {
    if (att.text?.content) content += att.text.content + "\n";
    if (att.query?.query) sql = att.query.query;
  }

  return {
    id: data.id,
    content: content.trim() || "Thinking...",
    role: "assistant",
    sql,
    status: data.status as GenieMessage["status"],
  };
}

export async function getGenieQueryResult(
  spaceId: string,
  conversationId: string,
  messageId: string,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const config = getConfig();
  const token = await getSpBearerToken();
  const url = `https://${config.serverHostname}/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}/query-result`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
    { timeoutMs: 30000 },
  );
  if (!res.ok) return { columns: [], rows: [] };
  const data = (await res.json()) as {
    statement_response?: {
      manifest?: { schema?: { columns?: Array<{ name: string }> } };
      result?: { data_array?: unknown[][] };
    };
  };
  const cols = data.statement_response?.manifest?.schema?.columns?.map((c) => c.name) ?? [];
  const rows = data.statement_response?.result?.data_array ?? [];
  return { columns: cols, rows };
}
