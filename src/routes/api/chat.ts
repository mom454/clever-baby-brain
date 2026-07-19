import { createFileRoute } from "@tanstack/react-router";
import { gatewayFetch } from "@/lib/ai-gateway.server";
import { requireAuthAndRateLimit } from "@/lib/api-guard.server";

type Attachment = { url: string; mimeType: string; name: string };
type InMsg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };
type Mode = "chat" | "research" | "code" | "voice";
type ProviderConfig = {
  provider: "lovable" | "openai" | "anthropic" | "google" | "perplexity";
  model: string;
  apiKey?: string;
};

const SYSTEM_BASE = `You are Baby, a warm, curious, highly capable personal AI companion that lives on the user's device. Help with learning, writing, coding, research, planning, creativity, and everyday thinking. Be friendly and concise by default; go deeper when the user wants. Format with Markdown when helpful. If the user shares a durable personal fact or preference worth remembering across conversations, end your reply with a single line formatted exactly like: [remember: <one concise fact>]. Only remember lasting facts, never the topic of the current conversation.`;

const MODE_PROMPTS: Record<Mode, string> = {
  chat: "",
  research:
    "\n\nRESEARCH MODE: You are in careful research mode. Cite sources inline as Markdown links like [source](https://example.com) whenever you reference a specific fact, study, product, event, or claim. Prefer authoritative sources. Distinguish between what you're confident about and what you're inferring. If a claim needs a live web check to be safely stated, say so.",
  code: "\n\nCODE MODE: You are pairing on code. Prefer runnable, complete snippets in fenced code blocks with the language tag. Explain briefly, then show the code. When editing, show a full replacement rather than a diff unless asked. Watch for edge cases, error handling, and types.",
  voice:
    "\n\nVOICE MODE: The user is speaking to you and will hear your reply out loud. Keep responses short, natural, and conversational. Avoid markdown, headings, bullet lists, and code unless explicitly asked. Do NOT emit [remember:] tags in voice mode.",
};

function buildSystem(mode: Mode, memories: string[] = []) {
  const memoryBlock = memories.length
    ? `\n\nWhat you remember about the user (durable facts they have told you):\n${memories
        .map((m) => `- ${m}`)
        .join("\n")}`
    : "";
  return SYSTEM_BASE + (MODE_PROMPTS[mode] ?? "") + memoryBlock;
}

// Build OpenAI-shaped messages (used for lovable / openai / perplexity).
function toOpenAIMessages(system: string, messages: InMsg[]) {
  const out: any[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      const parts: any[] = [{ type: "text", text: m.content ?? "" }];
      for (const att of m.attachments ?? []) {
        if (att.mimeType?.startsWith("image/")) {
          parts.push({ type: "image_url", image_url: { url: att.url } });
        } else if (
          att.mimeType === "application/pdf" ||
          att.mimeType?.startsWith("text/") ||
          att.mimeType?.includes("document")
        ) {
          parts.push({ type: "file", file: { filename: att.name, file_data: att.url } });
        }
      }
      out.push({ role: "user", content: parts });
    } else {
      out.push({ role: "assistant", content: m.content ?? "" });
    }
  }
  return out;
}

// Anthropic requires system as a top-level param and image parts in a specific
// shape. We only pass text + inline base64 images.
function toAnthropicPayload(system: string, messages: InMsg[], model: string) {
  const anth: any[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const content: any[] = [];
      for (const att of m.attachments ?? []) {
        if (att.mimeType?.startsWith("image/") && att.url.startsWith("data:")) {
          const [meta, data] = att.url.split(",");
          const media = meta.slice(5, meta.indexOf(";")) || "image/png";
          content.push({
            type: "image",
            source: { type: "base64", media_type: media, data },
          });
        }
      }
      content.push({ type: "text", text: m.content ?? "" });
      anth.push({ role: "user", content });
    } else {
      anth.push({ role: "assistant", content: m.content ?? "" });
    }
  }
  return { model, max_tokens: 4096, stream: true, system, messages: anth };
}

// Google Gemini's native shape.
function toGeminiPayload(system: string, messages: InMsg[]) {
  const contents: any[] = [];
  for (const m of messages) {
    const parts: any[] = [];
    if (m.role === "user") {
      parts.push({ text: m.content ?? "" });
      for (const att of m.attachments ?? []) {
        if (att.mimeType?.startsWith("image/") && att.url.startsWith("data:")) {
          const [meta, data] = att.url.split(",");
          const media = meta.slice(5, meta.indexOf(";")) || "image/png";
          parts.push({ inline_data: { mime_type: media, data } });
        }
      }
    } else {
      parts.push({ text: m.content ?? "" });
    }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return { systemInstruction: { parts: [{ text: system }] }, contents };
}

// Parse an OpenAI-compatible SSE stream and enqueue only the text deltas.
function pipeOpenAISSE(upstream: Response): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith("data:")) continue;
            const data = l.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              const delta = j.choices?.[0]?.delta?.content ?? "";
              if (delta) controller.enqueue(enc.encode(delta));
              // Perplexity attaches citations to the final chunk.
              const citations: string[] | undefined = j.citations;
              if (citations && citations.length) {
                const list = citations.map((c, i) => `[${i + 1}](${c})`).join(" ");
                controller.enqueue(enc.encode(`\n\n**Sources:** ${list}`));
              }
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

// Anthropic SSE emits typed events; we only forward text deltas.
function pipeAnthropicSSE(upstream: Response): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith("data:")) continue;
            try {
              const j = JSON.parse(l.slice(5).trim());
              if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
                controller.enqueue(enc.encode(j.delta.text));
              }
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

// Gemini streams a JSON array; each element has candidates[0].content.parts[].text.
function pipeGeminiSSE(upstream: Response): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          // extract balanced JSON objects at depth 1 inside the array
          let depth = 0;
          let start = -1;
          let inStr = false;
          let esc = false;
          const out: string[] = [];
          for (let i = 0; i < buf.length; i++) {
            const c = buf[i];
            if (inStr) {
              if (esc) esc = false;
              else if (c === "\\") esc = true;
              else if (c === '"') inStr = false;
              continue;
            }
            if (c === '"') inStr = true;
            else if (c === "{") {
              if (depth === 0) start = i;
              depth++;
            } else if (c === "}") {
              depth--;
              if (depth === 0 && start >= 0) {
                out.push(buf.slice(start, i + 1));
                start = -1;
              }
            }
          }
          if (out.length) {
            const lastEnd = buf.lastIndexOf("}") + 1;
            buf = buf.slice(lastEnd);
            for (const obj of out) {
              try {
                const j = JSON.parse(obj);
                const text = j.candidates?.[0]?.content?.parts
                  ?.map((p: any) => p.text ?? "")
                  .join("");
                if (text) controller.enqueue(enc.encode(text));
              } catch {
                /* ignore */
              }
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

function errorResponse(status: number, text: string) {
  if (status === 429) return new Response("Rate limited. Please slow down and try again.", { status: 429 });
  if (status === 402) return new Response("AI credits exhausted. Add credits or set a personal API key in Settings.", { status: 402 });
  if (status === 401 || status === 403)
    return new Response("Invalid or missing API key for that provider. Update it in Settings.", { status });
  return new Response(text || "AI error", { status: status >= 400 ? status : 500 });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages: InMsg[];
          memories?: string[];
          mode?: Mode;
          provider?: ProviderConfig;
        };
        const mode: Mode = body.mode ?? "chat";
        const system = buildSystem(mode, body.memories ?? []);
        const cfg: ProviderConfig = body.provider ?? { provider: "lovable", model: "openai/gpt-5.5" };

        const streamResponse = (stream: ReadableStream<Uint8Array>) =>
          new Response(stream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache",
              "X-Accel-Buffering": "no",
            },
          });

        try {
          if (cfg.provider === "lovable") {
            const upstream = await gatewayFetch("/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: cfg.model || "openai/gpt-5.5",
                messages: toOpenAIMessages(system, body.messages ?? []),
                stream: true,
              }),
            });
            if (!upstream.ok || !upstream.body)
              return errorResponse(upstream.status, await upstream.text().catch(() => ""));
            return streamResponse(pipeOpenAISSE(upstream));
          }

          if (!cfg.apiKey) return new Response("Missing API key for selected provider", { status: 400 });

          if (cfg.provider === "openai") {
            const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${cfg.apiKey}`,
              },
              body: JSON.stringify({
                model: cfg.model,
                messages: toOpenAIMessages(system, body.messages ?? []),
                stream: true,
              }),
            });
            if (!upstream.ok || !upstream.body)
              return errorResponse(upstream.status, await upstream.text().catch(() => ""));
            return streamResponse(pipeOpenAISSE(upstream));
          }

          if (cfg.provider === "perplexity") {
            const upstream = await fetch("https://api.perplexity.ai/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${cfg.apiKey}`,
              },
              body: JSON.stringify({
                model: cfg.model,
                messages: toOpenAIMessages(system, body.messages ?? []).map((m) =>
                  typeof m.content === "string"
                    ? m
                    : { role: m.role, content: m.content.map((p: any) => p.text ?? "").join("") },
                ),
                stream: true,
                return_citations: true,
              }),
            });
            if (!upstream.ok || !upstream.body)
              return errorResponse(upstream.status, await upstream.text().catch(() => ""));
            return streamResponse(pipeOpenAISSE(upstream));
          }

          if (cfg.provider === "anthropic") {
            const upstream = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": cfg.apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
              },
              body: JSON.stringify(toAnthropicPayload(system, body.messages ?? [], cfg.model)),
            });
            if (!upstream.ok || !upstream.body)
              return errorResponse(upstream.status, await upstream.text().catch(() => ""));
            return streamResponse(pipeAnthropicSSE(upstream));
          }

          if (cfg.provider === "google") {
            const upstream = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?key=${encodeURIComponent(cfg.apiKey)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toGeminiPayload(system, body.messages ?? [])),
              },
            );
            if (!upstream.ok || !upstream.body)
              return errorResponse(upstream.status, await upstream.text().catch(() => ""));
            return streamResponse(pipeGeminiSSE(upstream));
          }

          return new Response("Unsupported provider", { status: 400 });
        } catch (e: any) {
          return new Response(e?.message || "AI error", { status: 500 });
        }
      },
    },
  },
});
