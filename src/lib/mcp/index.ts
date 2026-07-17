import { auth, defineMcp } from "@lovable.dev/mcp-js";

import chatTool from "./tools/chat";
import deleteMemoryTool from "./tools/delete-memory";
import listMemoriesTool from "./tools/list-memories";
import saveMemoryTool from "./tools/save-memory";

// The MCP OAuth issuer must be the direct Supabase host, not the .lovable.cloud proxy.
// VITE_SUPABASE_PROJECT_ID is inlined at build time by Vite.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "baby-ai-mcp",
  title: "Baby AI",
  version: "0.1.0",
  instructions:
    "Baby AI — a personal AI assistant. Use `chat_with_baby` for one-shot replies, and `list_memories` / `save_memory` / `delete_memory` to read and manage the signed-in user's long-term memories.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [chatTool, listMemoriesTool, saveMemoryTool, deleteMemoryTool],
});
