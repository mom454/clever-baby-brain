import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { gatewayFetch } from "@/lib/ai-gateway.server";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Authenticate
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);

        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient<Database>(url, key, {
          global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
        const userId = userData.user.id;

        const body = (await request.json()) as {
          threadId: string;
          message: { content: string; attachments?: { url: string; mimeType: string; name: string }[] };
          model?: string;
        };
        const { threadId, message, model = "openai/gpt-5.5" } = body;

        // Verify thread ownership + fetch history
        const { data: thread, error: threadErr } = await supabase
          .from("threads").select("id, title").eq("id", threadId).eq("user_id", userId).maybeSingle();
        if (threadErr || !thread) return new Response("Thread not found", { status: 404 });

        const { data: history } = await supabase
          .from("messages").select("role, message").eq("thread_id", threadId).order("created_at", { ascending: true });

        const { data: memories } = await supabase
          .from("memories").select("content").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);

        // Build multimodal content
        const userContent: any[] = [{ type: "text", text: message.content }];
        for (const att of message.attachments ?? []) {
          if (att.mimeType.startsWith("image/")) {
            userContent.push({ type: "image_url", image_url: { url: att.url } });
          } else if (att.mimeType === "application/pdf" || att.mimeType.startsWith("text/") || att.mimeType.includes("document")) {
            // Fetch and inline as file
            const r = await fetch(att.url);
            const buf = new Uint8Array(await r.arrayBuffer());
            const b64 = btoa(String.fromCharCode(...buf));
            userContent.push({ type: "file", file: { filename: att.name, file_data: `data:${att.mimeType};base64,${b64}` } });
          }
        }

        // Persist user message
        await supabase.from("messages").insert({
          thread_id: threadId, user_id: userId, role: "user",
          message: { content: message.content, attachments: message.attachments ?? [] },
        });

        // Build system prompt
        const memoryBlock = memories?.length
          ? `\n\nWhat you remember about the user:\n${memories.map((m) => `- ${m.content}`).join("\n")}`
          : "";
        const systemPrompt = `You are Baby, a warm, curious, and highly capable personal AI assistant. You help with learning, writing, coding, research, planning, creativity, and everyday thinking. Be friendly and concise by default; go deeper when the user wants. Format with Markdown when helpful. If the user shares something personal or a lasting preference you should remember, include a line at the very end of your response formatted exactly as: [remember: <one-sentence fact>]. Only remember durable facts, not the topic of the conversation.${memoryBlock}`;

        // Build messages array
        const chatMessages: any[] = [{ role: "system", content: systemPrompt }];
        for (const h of history ?? []) {
          const m = h.message as any;
          if (h.role === "user") {
            const parts: any[] = [{ type: "text", text: m.content ?? "" }];
            for (const att of m.attachments ?? []) {
              if (att.mimeType?.startsWith("image/")) parts.push({ type: "image_url", image_url: { url: att.url } });
            }
            chatMessages.push({ role: "user", content: parts });
          } else {
            chatMessages.push({ role: "assistant", content: m.content ?? "" });
          }
        }
        chatMessages.push({ role: "user", content: userContent });

        // Call gateway with streaming
        const upstream = await gatewayFetch("/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: chatMessages, stream: true }),
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => "");
          if (upstream.status === 429) return new Response("Rate limited. Please slow down.", { status: 429 });
          if (upstream.status === 402) return new Response("AI credits exhausted. Please add credits in your workspace.", { status: 402 });
          return new Response(`AI error: ${errText}`, { status: 500 });
        }

        // Transform SSE to plain text stream and capture full content
        let full = "";
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
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
                    if (delta) { full += delta; controller.enqueue(encoder.encode(delta)); }
                  } catch {}
                }
              }
            } finally {
              // Extract and save memory
              const memMatch = full.match(/\[remember:\s*([^\]]+)\]/i);
              const clean = full.replace(/\[remember:[^\]]+\]/gi, "").trim();
              await supabase.from("messages").insert({
                thread_id: threadId, user_id: userId, role: "assistant",
                message: { content: clean },
              });
              if (memMatch) {
                await supabase.from("memories").insert({ user_id: userId, content: memMatch[1].trim() });
              }
              // Auto-title if still default
              if (thread.title === "New chat") {
                const title = message.content.slice(0, 60).trim() || "New chat";
                await supabase.from("threads").update({ title, updated_at: new Date().toISOString() }).eq("id", threadId);
              } else {
                await supabase.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
              }
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
