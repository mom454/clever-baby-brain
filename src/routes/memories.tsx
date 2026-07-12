import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSyncExternalStore, useState } from "react";
import { store, subscribeStore } from "@/lib/local-store";
import { toast } from "sonner";
import { Trash2, Plus, BrainCircuit } from "lucide-react";

export const Route = createFileRoute("/memories")({
  ssr: false,
  component: MemoriesPage,
});

function useMemories() {
  return useSyncExternalStore(
    subscribeStore,
    () => store.getMemories(),
    () => [],
  );
}

function MemoriesPage() {
  const memories = useMemories();
  const [text, setText] = useState("");

  function add() {
    const t = text.trim();
    if (!t) return;
    store.addMemory(t);
    setText("");
    toast.success("Memory saved");
  }

  return (
    <AppShell>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <BrainCircuit size={20} />
          </div>
          <div>
            <h1 className="display text-3xl">Memories</h1>
            <p className="text-sm text-muted-foreground">
              Things Baby remembers about you. Stored privately in your browser.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="surface mb-4 flex gap-2 rounded-2xl p-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add something Baby should remember…"
            className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
          />
          <button
            className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={!text.trim()}
          >
            <Plus size={16} /> Add
          </button>
        </form>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {memories.length === 0 && (
            <div className="mt-12 text-center text-sm text-muted-foreground">No memories yet.</div>
          )}
          {memories.map((m) => (
            <div
              key={m.id}
              className="surface group flex items-start justify-between gap-3 rounded-xl p-4 animate-fade-in-up"
            >
              <p className="text-sm">{m.content}</p>
              <button
                onClick={() => store.deleteMemory(m.id)}
                className="opacity-0 transition group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                aria-label="Delete memory"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center">
          <Link to="/chat" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to chat
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
