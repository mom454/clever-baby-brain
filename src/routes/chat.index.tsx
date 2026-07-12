import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { store } from "@/lib/local-store";

export const Route = createFileRoute("/chat/")({
  ssr: false,
  component: ChatIndex,
});

function ChatIndex() {
  const navigate = useNavigate();
  useEffect(() => {
    const existing = store.getThreads();
    const threadId = existing[0]?.id ?? store.createThread().id;
    navigate({ to: "/chat/$threadId", params: { threadId }, replace: true });
  }, [navigate]);
  return null;
}
