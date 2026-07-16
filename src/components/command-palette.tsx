import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "@/components/theme-provider";
import { store } from "@/lib/local-store";
import { MODELS, settings, useSettings } from "@/lib/settings-store";
import {
  MessageSquare,
  BrainCircuit,
  Image as ImageIcon,
  Settings as SettingsIcon,
  Mic,
  Sun,
  Moon,
  Search,
  Code2,
  Cpu,
  Plus,
} from "lucide-react";

// Global ⌘K / Ctrl-K palette. Mounted once at the root.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"root" | "model">("root");
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const s = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run(fn: () => void) {
    setOpen(false);
    setPage("root");
    setTimeout(fn, 10);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[16vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="surface w-full max-w-xl overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command loop>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search size={16} className="text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder={page === "model" ? "Choose model…" : "Type a command or search…"}
              className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
          </div>
          <Command.List className="max-h-[50vh] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              Nothing matches.
            </Command.Empty>

            {page === "root" && (
              <>
                <Command.Group heading="Actions">
                  <Item
                    icon={<Plus size={14} />}
                    label="New chat"
                    shortcut="⇧⌘N"
                    onSelect={() =>
                      run(() => {
                        const t = store.createThread();
                        navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
                      })
                    }
                  />
                  <Item
                    icon={<Mic size={14} />}
                    label="Start voice conversation"
                    onSelect={() => run(() => navigate({ to: "/voice" }))}
                  />
                  <Item
                    icon={<ImageIcon size={14} />}
                    label="Generate an image (/image)"
                    onSelect={() =>
                      run(() => {
                        const existing = store.getThreads()[0];
                        const t = existing ?? store.createThread();
                        navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
                        setTimeout(() => {
                          window.dispatchEvent(
                            new CustomEvent("baby:prefill", { detail: "/image " }),
                          );
                        }, 60);
                      })
                    }
                  />
                </Command.Group>
                <Command.Group heading="Navigate">
                  <Item
                    icon={<MessageSquare size={14} />}
                    label="Recent chats"
                    onSelect={() => run(() => navigate({ to: "/chat" }))}
                  />
                  <Item
                    icon={<BrainCircuit size={14} />}
                    label="Memories"
                    onSelect={() => run(() => navigate({ to: "/memories" }))}
                  />
                  <Item
                    icon={<SettingsIcon size={14} />}
                    label="Settings & API keys"
                    onSelect={() => run(() => navigate({ to: "/settings" }))}
                  />
                </Command.Group>
                <Command.Group heading="Preferences">
                  <Item
                    icon={<Cpu size={14} />}
                    label={`Switch model · ${MODELS.find((m) => m.id === s.selectedModelId)?.label ?? s.selectedModelId}`}
                    onSelect={() => setPage("model")}
                  />
                  <Item
                    icon={theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                    label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                    onSelect={() => run(toggle)}
                  />
                </Command.Group>
                <Command.Group heading="Modes">
                  <Item
                    icon={<Search size={14} />}
                    label="Research mode (web + citations)"
                    onSelect={() =>
                      run(() => window.dispatchEvent(new CustomEvent("baby:mode", { detail: "research" })))
                    }
                  />
                  <Item
                    icon={<Code2 size={14} />}
                    label="Coding mode"
                    onSelect={() =>
                      run(() => window.dispatchEvent(new CustomEvent("baby:mode", { detail: "code" })))
                    }
                  />
                  <Item
                    icon={<MessageSquare size={14} />}
                    label="Chat mode"
                    onSelect={() =>
                      run(() => window.dispatchEvent(new CustomEvent("baby:mode", { detail: "chat" })))
                    }
                  />
                </Command.Group>
              </>
            )}

            {page === "model" && (
              <Command.Group heading="Models">
                {MODELS.map((m) => {
                  const needsKey = m.provider !== "lovable" && !s.keys[m.provider];
                  return (
                    <Command.Item
                      key={m.id}
                      value={`${m.label} ${m.provider}`}
                      onSelect={() =>
                        run(() => {
                          if (needsKey) navigate({ to: "/settings" });
                          else settings.set({ selectedModelId: m.id });
                        })
                      }
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-accent"
                    >
                      <div className="flex items-center gap-2">
                        <Cpu size={14} className="opacity-60" />
                        <span>{m.label}</span>
                        {m.id === s.selectedModelId && (
                          <span className="text-[10px] text-primary">● active</span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {needsKey ? "Add key" : m.hint ?? m.provider}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
          </Command.List>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <span>Baby · private on this device</span>
            <span>
              <kbd className="rounded bg-muted px-1">↵</kbd> to select ·{" "}
              <kbd className="rounded bg-muted px-1">⌘K</kbd> to toggle
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function Item({
  icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-accent"
    >
      <div className="flex items-center gap-2">
        <span className="opacity-70">{icon}</span>
        <span>{label}</span>
      </div>
      {shortcut && <span className="text-[10px] text-muted-foreground">{shortcut}</span>}
    </Command.Item>
  );
}
