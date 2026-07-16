import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, MessageSquare, BrainCircuit, Trash2, Sparkles, Sun, Moon, Menu, Settings as SettingsIcon, Mic, Command as CommandIcon } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { store, subscribeStore } from "@/lib/local-store";

export function AppShell({ children, activeThreadId }: { children: ReactNode; activeThreadId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-screen">
      <Sidebar activeThreadId={activeThreadId} mobileOpen={open} onCloseMobile={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar onMenu={() => setOpen(true)} />
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border p-3 md:hidden">
      <button onClick={onMenu} className="rounded-lg p-2 hover:bg-accent" aria-label="Open menu">
        <Menu size={18} />
      </button>
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-full bg-primary animate-pulse-glow" />
        <span className="display text-xl">Baby</span>
      </div>
    </div>
  );
}

function useThreads() {
  return useSyncExternalStore(
    subscribeStore,
    () => store.getThreads(),
    () => [],
  );
}

function Sidebar({
  activeThreadId,
  mobileOpen,
  onCloseMobile,
}: {
  activeThreadId?: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const threads = useThreads();

  function newThread() {
    const t = store.createThread();
    navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    onCloseMobile();
  }

  function del(id: string) {
    store.deleteThread(id);
    if (id === activeThreadId) navigate({ to: "/chat" });
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onCloseMobile} />
      )}
      <aside
        className={cn(
          "z-50 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar",
          "fixed inset-y-0 left-0 transition-transform md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="relative h-8 w-8">
            <div className="h-8 w-8 rounded-full bg-primary animate-pulse-glow" />
            <div className="absolute inset-0 h-8 w-8 rounded-full bg-primary blur-md opacity-60" />
          </div>
          <span className="display text-2xl">Baby</span>
        </div>

        <div className="px-3">
          <button
            onClick={newThread}
            className="glow-ring flex w-full items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus size={16} /> New chat
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto px-2">
          <div className="mb-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">Chats</div>
          {threads.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No chats yet</div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                t.id === activeThreadId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60",
              )}
            >
              <Link
                to="/chat/$threadId"
                params={{ threadId: t.id }}
                onClick={onCloseMobile}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <MessageSquare size={14} className="shrink-0 opacity-60" />
                <span className="truncate">{t.title || "Untitled"}</span>
              </Link>
              <button
                onClick={() => del(t.id)}
                className="shrink-0 opacity-0 transition group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-sidebar-border p-2">
          <Link
            to="/voice"
            onClick={onCloseMobile}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            <Mic size={16} className="opacity-70" /> Voice mode
          </Link>
          <Link
            to="/memories"
            onClick={onCloseMobile}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            <BrainCircuit size={16} className="opacity-70" /> Memories
          </Link>
          <Link
            to="/settings"
            onClick={onCloseMobile}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            <SettingsIcon size={16} className="opacity-70" /> Settings
          </Link>
          <button
            onClick={toggle}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            {theme === "dark" ? (
              <Sun size={16} className="opacity-70" />
            ) : (
              <Moon size={16} className="opacity-70" />
            )}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          <button
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
            }
            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent/60"
          >
            <span className="flex items-center gap-2">
              <CommandIcon size={16} className="opacity-70" /> Command palette
            </span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
          </button>
          <div className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground">
            <Sparkles size={12} className="text-primary" />
            <span className="truncate">Private · lives on this device</span>
          </div>
        </div>
      </aside>
    </>
  );
}
