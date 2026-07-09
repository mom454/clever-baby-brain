import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/chat/")({
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    // Find most recent thread or create one
    const { data: threads } = await supabase
      .from("threads")
      .select("id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (threads && threads.length > 0) {
      throw redirect({ to: "/chat/$threadId", params: { threadId: threads[0].id } });
    }
    const { data: t, error } = await supabase
      .from("threads")
      .insert({ user_id: user.id, title: "New chat" })
      .select("id")
      .single();
    if (error || !t) throw new Error(error?.message ?? "Could not create thread");
    throw redirect({ to: "/chat/$threadId", params: { threadId: t.id } });
  },
  component: () => null,
});
