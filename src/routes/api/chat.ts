import { createFileRoute } from "@tanstack/react-router";
import { gatewayFetch } from "@/lib/ai-gateway.server";

type Attachment = { url: string; mimeType: string; name: string };
type InMsg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages: InMsg[];
          memories?: string[];
          model?: string;
        };
        const model = body.model ?? "openai/gpt-5.5";
        const memoryBlock =
          body.memories && body.memories.length
            ? `\n\nWhat you remember about the user (durable facts they have told you):\n${body.memories
                .map((m) => `- ${m}`)
                .join("\n")}`
            : "";

        const systemPrompt = `You are Baby, a warm, curious, highly capable personal AI companion that lives on the user's device. Help with learning, writing, coding, research, planning, creativity, and everyday thinking. Be friendly and concise by default; go deeper when the user wants. Format with Markdown when helpful. If the user shares a durable personal fact or preference worth remembering across conversations, end your reply with a single line formatted exactly like: [remember: <one concise fact>]. Only remember lasting facts, never the topic of the current conversation.${memoryBlock}`;

        const chatMessages: any[] = [{ role: "system", content: systemPrompt }];
        for (const m of body.messages ?? []) {
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
                parts.push({
                  type: "file",
                  file: { filename: att.name, file_data: att.url },
                });
              }
            }
            chatMessages.push({ role: "user", content: parts });
          } else {
            chatMessages.push({ role: "assistant", content: m.content ?? "" });
          }
        }

        const upstream = await gatewayFetch("/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: chatMessages, stream: true }),
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => "");
          if (upstream.status === 429)
            return new Response("Rate limited. Please slow down and try again.", { status: 429 });
          if (upstream.status === 402)
            return new Response("AI credits exhausted. Add credits to your workspace to continue.", {
              status: 402,
            });
          return new Response(errText || "AI error", { status: 500 });
        }

        const enc = new TextEncoder();
        const dec = new TextDecoder();
        const stream = new ReadableStream({
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
                  } catch {
                    // ignore malformed chunk
                  }
                }
              }
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
