import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { mcpStore, useMcpServers, type McpServer, type McpTool } from "@/lib/mcp-store";
import { toast } from "sonner";
import {
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Play,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/integrations")({
  ssr: false,
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const servers = useMcpServers();

  return (
    <AppShell>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto p-6">
        <header className="mb-6">
          <div className="flex items-center gap-2">
            <Plug size={18} className="text-primary" />
            <h1 className="display text-4xl">Integrations</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect Baby to external tools and data through the Model Context Protocol (MCP). Point
            Baby at any MCP-compatible server — GitHub, Notion, filesystem, a self-hosted agent —
            and its tools become available here. Servers and tokens stay in this browser.
          </p>
        </header>

        <AddServerForm />

        <section className="mt-6 space-y-3">
          {servers.length === 0 && (
            <div className="surface rounded-2xl p-6 text-center text-sm text-muted-foreground">
              No MCP servers connected yet. Add one above to get started.
            </div>
          )}
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </section>

        <section className="surface mt-8 flex items-start gap-3 rounded-2xl p-5">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">How this works.</strong> Baby forwards JSON-RPC
            requests to the URL you provide through a thin server proxy (to bypass CORS). Your auth
            token is only sent to that URL, never stored on our servers. Some MCP servers require an
            API key or paid subscription from the underlying service — if a call fails with that
            reason, you'll see it in the response below.
          </div>
        </section>

        <div className="my-8 text-center">
          <Link to="/chat" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to chat
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function AddServerForm() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!url.trim()) return toast.error("Server URL is required");
    setBusy(true);
    try {
      const server = mcpStore.add({ name, url, authToken: token });
      await refreshTools(server.id);
      setName("");
      setUrl("");
      setToken("");
      toast.success("MCP server added");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        <Plus size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">Connect an MCP server</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. GitHub)"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/v1"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="Bearer token (optional)"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 sm:col-span-2"
        />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <a
          href="https://modelcontextprotocol.io/introduction"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          What is MCP? <ExternalLink size={11} />
        </a>
        <button
          disabled={busy}
          onClick={submit}
          className="glow-ring rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </section>
  );
}

async function refreshTools(id: string) {
  const server = mcpStore.list().find((s) => s.id === id);
  if (!server) return;
  mcpStore.update(id, { lastError: undefined });
  try {
    const r = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "list-tools",
        url: server.url,
        authToken: server.authToken,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const message =
        r.status === 401 || r.status === 403
          ? "This server requires a valid API key or subscription."
          : j.error || `Failed (${r.status})`;
      mcpStore.update(id, { lastError: message, tools: [] });
      toast.error(message);
      return;
    }
    mcpStore.update(id, {
      tools: (j.tools ?? []) as McpTool[],
      lastConnectedAt: Date.now(),
      lastError: undefined,
    });
    toast.success(`Loaded ${j.tools?.length ?? 0} tools`);
  } catch (e: any) {
    mcpStore.update(id, { lastError: e?.message ?? "Network error" });
    toast.error(e?.message ?? "Network error");
  }
}

function ServerCard({ server }: { server: McpServer }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded p-1 hover:bg-accent"
          aria-label="Toggle tools"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{server.name}</span>
            <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={(e) => mcpStore.update(server.id, { enabled: e.target.checked })}
              />
              {server.enabled ? "Enabled" : "Disabled"}
            </label>
          </div>
          <div className="truncate text-xs text-muted-foreground">{server.url}</div>
          {server.lastError && (
            <div className="mt-1 text-xs text-destructive">{server.lastError}</div>
          )}
          {!server.lastError && server.tools && (
            <div className="mt-1 text-xs text-muted-foreground">
              {server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await refreshTools(server.id);
            setBusy(false);
          }}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground disabled:opacity-60"
          aria-label="Refresh"
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        </button>
        <button
          onClick={() => {
            if (confirm(`Remove ${server.name}?`)) mcpStore.remove(server.id);
          }}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"
          aria-label="Remove"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {(!server.tools || server.tools.length === 0) && (
            <div className="text-xs text-muted-foreground">
              No tools loaded. Click refresh to fetch them.
            </div>
          )}
          {server.tools?.map((t) => (
            <ToolRow key={t.name} server={server} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ server, tool }: { server: McpServer; tool: McpTool }) {
  const [args, setArgs] = useState("{}");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function run() {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = args.trim() ? JSON.parse(args) : {};
    } catch {
      toast.error("Arguments must be valid JSON");
      return;
    }
    setRunning(true);
    setOutput(null);
    try {
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "call-tool",
          url: server.url,
          authToken: server.authToken,
          toolName: tool.name,
          arguments: parsed,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg =
          r.status === 401 || r.status === 403
            ? "This tool requires a valid API key or subscription for the upstream service."
            : j.error || `Failed (${r.status})`;
        setOutput(msg);
      } else {
        setOutput(JSON.stringify(j.result, null, 2));
      }
    } catch (e: any) {
      setOutput(e?.message ?? "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="font-mono text-xs text-primary">{tool.name}</div>
          {tool.description && (
            <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {tool.description}
            </div>
          )}
        </button>
        <button
          onClick={run}
          disabled={running || !server.enabled}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/80 disabled:opacity-60"
        >
          <Play size={11} /> {running ? "Running…" : "Run"}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          <textarea
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            spellCheck={false}
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/30"
            placeholder='{"key": "value"}'
          />
        </div>
      )}
      {output !== null && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted/50 p-2 text-[11px] leading-relaxed">
          {output}
        </pre>
      )}
    </div>
  );
}
