import { createFileRoute } from "@tanstack/react-router";

// Server-side proxy for MCP (Model Context Protocol) Streamable HTTP servers.
// The browser can't reliably talk to arbitrary MCP endpoints (CORS, custom
// headers), so we forward JSON-RPC through this route. This proxy does NOT
// persist anything and does NOT talk to the AI gateway — it only speaks
// JSON-RPC 2.0 to a URL the user provided.

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
};

async function rpc(
  url: string,
  authToken: string | undefined,
  body: JsonRpcRequest,
  sessionId?: string,
): Promise<{ ok: true; data: any; sessionId?: string } | { ok: false; status: number; error: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e: any) {
    return { ok: false, status: 502, error: e?.message ?? "Network error" };
  }

  const newSession = res.headers.get("Mcp-Session-Id") ?? sessionId;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: text || res.statusText };
  }

  // For notifications there is no response body.
  if (res.status === 202) return { ok: true, data: null, sessionId: newSession ?? undefined };

  const ct = res.headers.get("Content-Type") ?? "";
  if (ct.includes("text/event-stream")) {
    // Read the first data frame that contains the response for our id.
    const text = await res.text();
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    for (const chunk of dataLines) {
      try {
        const parsed = JSON.parse(chunk);
        if (parsed && (parsed.id === body.id || parsed.result || parsed.error)) {
          return { ok: true, data: parsed, sessionId: newSession ?? undefined };
        }
      } catch {
        /* keep scanning */
      }
    }
    return { ok: false, status: 502, error: "Empty MCP stream" };
  }

  try {
    const data = await res.json();
    return { ok: true, data, sessionId: newSession ?? undefined };
  } catch (e: any) {
    return { ok: false, status: 502, error: e?.message ?? "Invalid JSON from MCP server" };
  }
}

async function initialize(url: string, authToken?: string) {
  const init = await rpc(url, authToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      clientInfo: { name: "Baby", version: "1.0.0" },
    },
  });
  if (!init.ok) return init;

  // Fire-and-forget "initialized" notification (per MCP spec).
  await rpc(
    url,
    authToken,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    init.sessionId,
  ).catch(() => {});

  return { ...init, sessionId: init.sessionId } as const;
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          action: "list-tools" | "call-tool";
          url: string;
          authToken?: string;
          toolName?: string;
          arguments?: Record<string, unknown>;
        };

        if (!body?.url) return new Response("Missing url", { status: 400 });

        try {
          new URL(body.url);
        } catch {
          return new Response("Invalid URL", { status: 400 });
        }

        const init = await initialize(body.url, body.authToken);
        if (!init.ok)
          return Response.json({ error: init.error }, { status: init.status });

        if (body.action === "list-tools") {
          const r = await rpc(
            body.url,
            body.authToken,
            { jsonrpc: "2.0", id: 2, method: "tools/list" },
            init.sessionId,
          );
          if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
          const tools = r.data?.result?.tools ?? [];
          return Response.json({ tools });
        }

        if (body.action === "call-tool") {
          if (!body.toolName) return new Response("Missing toolName", { status: 400 });
          const r = await rpc(
            body.url,
            body.authToken,
            {
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: body.toolName, arguments: body.arguments ?? {} },
            },
            init.sessionId,
          );
          if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
          if (r.data?.error)
            return Response.json({ error: r.data.error.message ?? "Tool error" }, { status: 400 });
          return Response.json({ result: r.data?.result });
        }

        return new Response("Unknown action", { status: 400 });
      },
    },
  },
});
