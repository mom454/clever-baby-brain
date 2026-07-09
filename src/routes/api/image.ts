import { createFileRoute } from "@tanstack/react-router";
import { gatewayFetch } from "@/lib/ai-gateway.server";
import { createClient } from "@supabase/supabase-js";

// Chat-shape Gemini image generation. Returns { image: dataUrl }.
export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: u } = await supabase.auth.getUser(token);
        if (!u.user) return new Response("Unauthorized", { status: 401 });

        const { prompt, referenceUrl } = (await request.json()) as { prompt: string; referenceUrl?: string };
        if (!prompt) return new Response("Missing prompt", { status: 400 });

        const content: any[] = [{ type: "text", text: prompt }];
        if (referenceUrl) content.push({ type: "image_url", image_url: { url: referenceUrl } });

        const r = await gatewayFetch("/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            messages: [{ role: "user", content }],
            modalities: ["image", "text"],
          }),
        });
        if (!r.ok) return new Response(await r.text(), { status: r.status });
        const j = await r.json() as any;
        const msg = j.choices?.[0]?.message;
        const img = msg?.images?.[0]?.image_url?.url ?? msg?.image_url?.url;
        if (!img) return new Response("No image returned", { status: 500 });
        return Response.json({ image: img });
      },
    },
  },
});
