// Local, private MCP (Model Context Protocol) server registry.
// Each entry describes a remote MCP server the user has connected.
// Nothing is sent anywhere until the user explicitly calls a tool.

import { useSyncExternalStore } from "react";

export type McpServer = {
  id: string;
  name: string;
  url: string;
  authToken?: string;
  enabled: boolean;
  tools?: McpTool[];
  lastConnectedAt?: number;
  lastError?: string;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const KEY = "baby.mcp.servers.v1";

let cache: McpServer[] | null = null;
const listeners = new Set<() => void>();

function read(): McpServer[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as McpServer[]) : [];
  } catch {
    return [];
  }
}

function write(next: McpServer[]) {
  cache = next;
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function id() {
  return crypto.randomUUID?.() ?? `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const mcpStore = {
  list(): McpServer[] {
    if (!cache) cache = read();
    return cache;
  },
  add(input: { name: string; url: string; authToken?: string }): McpServer {
    const server: McpServer = {
      id: id(),
      name: input.name.trim() || new URL(input.url).host,
      url: input.url.trim(),
      authToken: input.authToken?.trim() || undefined,
      enabled: true,
    };
    write([...mcpStore.list(), server]);
    return server;
  },
  update(id: string, patch: Partial<McpServer>) {
    write(mcpStore.list().map((s) => (s.id === id ? { ...s, ...patch } : s)));
  },
  remove(id: string) {
    write(mcpStore.list().filter((s) => s.id !== id));
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function useMcpServers(): McpServer[] {
  return useSyncExternalStore(
    (cb) => mcpStore.subscribe(cb),
    () => mcpStore.list(),
    () => [],
  );
}
