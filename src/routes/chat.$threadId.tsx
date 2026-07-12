import { createFileRoute } from "@tanstack/react-router";
import { ChatWindow } from "@/components/chat/chat-window";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/chat/$threadId")({
  ssr: false,
  component: ChatPage,
});

function ChatPage() {
  const { threadId } = Route.useParams();
  return (
    <AppShell activeThreadId={threadId}>
      <ChatWindow key={threadId} threadId={threadId} />
    </AppShell>
  );
}
