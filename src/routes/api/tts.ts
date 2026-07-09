import { createFileRoute } from "@tanstack/react-router";
import { gatewayFetch } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const { text, voice = "alloy" } = (await request.json()) as { text: string; voice?: string };
        if (!text) return new Response("Missing text", { status: 400 });
        const r = await gatewayFetch("/audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-4o-mini-tts", input: text.slice(0, 4000), voice, response_format: "mp3" }),
        });
        if (!r.ok) return new Response(await r.text(), { status: r.status });
        return new Response(r.body, { headers: { "Content-Type": "audio/mpeg" } });
      },
    },
  },
});
