import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "chat_with_baby",
  title: "Chat with Baby AI",
  description:
    "Send a message to Baby AI and get a single reply using the Lovable AI Gateway. Stateless — pass any relevant context in the prompt.",
  inputSchema: {
    prompt: z.string().trim().min(1).describe("The user prompt for Baby AI."),
    system: z
      .string()
      .optional()
      .describe("Optional system instructions to steer the reply."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ prompt, system }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return { content: [{ type: "text", text: "LOVABLE_API_KEY missing" }], isError: true };
    }
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { content: [{ type: "text", text: `AI gateway error: ${text}` }], isError: true };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content ?? "";
    return {
      content: [{ type: "text", text: reply }],
      structuredContent: { reply },
    };
  },
});
