import { createFileRoute } from "@tanstack/react-router";
import { gatewayFetch } from "@/lib/ai-gateway.server";
import { requireAuthAndRateLimit } from "@/lib/api-guard.server";

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireAuthAndRateLimit(request);
        if (!guard.ok) return guard.response;

        const inbound = await request.formData();
        const file = inbound.get("file");
        if (!(file instanceof File)) return new Response("Missing file", { status: 400 });

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-transcribe");
        upstream.append("file", file, file.name || "recording.webm");
        const r = await gatewayFetch("/audio/transcriptions", { method: "POST", body: upstream });
        const text = await r.text();
        if (!r.ok) return new Response(text, { status: r.status });
        return new Response(text, { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
