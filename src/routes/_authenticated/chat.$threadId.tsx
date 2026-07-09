import { createFileRoute } from "@tanstack/react-router";
import { ChatWindow } from "@/components/chat/chat-window";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
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
