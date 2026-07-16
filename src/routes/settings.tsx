import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MODELS, settings, useSettings, type Provider } from "@/lib/settings-store";
import { store } from "@/lib/local-store";
import { toast } from "sonner";
import { KeyRound, Cpu, Trash2, ShieldCheck, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/settings")({
  ssr: false,
  component: SettingsPage,
});

const PROVIDERS: {
  id: Provider;
  name: string;
  href: string;
  placeholder: string;
  note: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    href: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
    note: "GPT-4o, o1, DALL·E — pay-as-you-go",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    href: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
    note: "Claude 4 Opus / Sonnet / Haiku",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    href: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
    note: "Gemini 2.5 Pro / Flash — free tier available",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    href: "https://www.perplexity.ai/settings/api",
    placeholder: "pplx-…",
    note: "Sonar — live web search with citations",
  },
];

function SettingsPage() {
  const s = useSettings();

  return (
    <AppShell>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto p-6">
        <header className="mb-8">
          <h1 className="display text-4xl">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Configure Baby's brain. Everything here — including API keys — stays in your browser and is
            only sent to a provider when you send a message that uses it.
          </p>
        </header>

        <section className="surface mb-6 rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <Cpu size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Default model</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Baby uses the built-in models by default (no key needed). Add a personal API key below to
            unlock Claude, Gemini, GPT-4o, or Perplexity.
          </p>
          <select
            value={s.selectedModelId}
            onChange={(e) => settings.set({ selectedModelId: e.target.value })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          >
            {MODELS.map((m) => {
              const missing = m.provider !== "lovable" && !s.keys[m.provider];
              return (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {missing ? " — needs API key" : m.hint ? ` — ${m.hint}` : ""}
                </option>
              );
            })}
          </select>
        </section>

        <section className="mb-6 space-y-3">
          <div className="mb-2 flex items-center gap-2">
            <KeyRound size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Bring-your-own API keys</h2>
          </div>
          {PROVIDERS.map((p) => (
            <div key={p.id} className="surface rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.note}</div>
                </div>
                <a
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Get key <ExternalLink size={11} />
                </a>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={s.keys[p.id] ? "•••••• saved" : p.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      settings.setKey(p.id, (e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                      toast.success(`${p.name} key saved`);
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value) {
                      settings.setKey(p.id, e.target.value);
                      e.target.value = "";
                      toast.success(`${p.name} key saved`);
                    }
                  }}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                {s.keys[p.id] && (
                  <button
                    onClick={() => {
                      settings.setKey(p.id, "");
                      toast.success(`${p.name} key removed`);
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>

        <section className="surface mb-6 rounded-2xl p-5">
          <h2 className="mb-2 text-sm font-semibold">Voice</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Baby's speaking voice for read-aloud and voice conversations.
          </p>
          <div className="flex flex-wrap gap-2">
            {["alloy", "ash", "ballad", "coral", "echo", "sage", "verse", "shimmer"].map((v) => (
              <button
                key={v}
                onClick={() => settings.set({ voice: v })}
                className={`rounded-full border px-3 py-1.5 text-xs capitalize transition ${
                  s.voice === v
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </section>

        <section className="surface mb-6 flex items-start gap-3 rounded-2xl p-5">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">Privacy.</strong> Keys and conversations live only in
            this browser's local storage. When you send a message, the key travels through Baby's
            server proxy only long enough to reach the provider — never logged, never persisted.
          </div>
        </section>

        <section className="mb-10">
          <button
            onClick={() => {
              if (confirm("Delete all chats, memories, and settings from this browser?")) {
                store.clearAll();
                localStorage.removeItem("baby.settings.v1");
                toast.success("Baby's memory cleared");
                setTimeout(() => location.reload(), 400);
              }
            }}
            className="flex items-center gap-2 rounded-xl border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={14} /> Wipe everything on this device
          </button>
        </section>

        <div className="mb-6 text-center">
          <Link to="/chat" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to chat
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
