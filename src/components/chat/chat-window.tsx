import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Paperclip,
  Mic,
  Image as ImageIcon,
  Sparkles,
  Volume2,
  X,
  Square,
  Search,
  Code2,
  MessageSquare,
  Cpu,
  Command as CommandIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  store,
  subscribeStore,
  fileToAttachment,
  type Attachment,
  type Msg,
} from "@/lib/local-store";
import { MODELS, parseModelId, useSettings } from "@/lib/settings-store";
import { Link } from "@tanstack/react-router";

type Mode = "chat" | "research" | "code";

function useMessages(threadId: string) {
  return useSyncExternalStore(
    subscribeStore,
    () => store.getMessages(threadId),
    () => [] as Msg[],
  );
}

export function ChatWindow({ threadId }: { threadId: string }) {
  const messages = useMessages(threadId);
  const s = useSettings();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentModel = MODELS.find((m) => m.id === s.selectedModelId);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText]);

  // Command palette can prefill the composer or switch modes.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      setInput((v) => v + (e as CustomEvent<string>).detail);
      textareaRef.current?.focus();
    };
    const onMode = (e: Event) => setMode((e as CustomEvent<Mode>).detail);
    window.addEventListener("baby:prefill", onPrefill);
    window.addEventListener("baby:mode", onMode);
    return () => {
      window.removeEventListener("baby:prefill", onPrefill);
      window.removeEventListener("baby:mode", onMode);
    };
  }, []);

  const send = useCallback(async () => {
    const content = input.trim();
    if ((!content && pending.length === 0) || streaming) return;
    setInput("");
    const atts = pending;
    setPending([]);
    setStreaming(true);
    setStreamText("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      store.addMessage({
        threadId,
        role: "user",
        content,
        attachments: atts.length ? atts : undefined,
      });

      const t = store.getThread(threadId);
      if (t && t.title === "New chat" && content) {
        store.updateThread(threadId, { title: content.slice(0, 60) });
      }

      if (content.startsWith("/image ")) {
        const prompt = content.slice(7).trim();
        const r = await (await import("@/lib/authed-fetch")).authedFetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, referenceUrl: atts[0]?.url }),
        });
        if (!r.ok) throw new Error(await r.text());
        const { image } = (await r.json()) as { image: string };
        store.addMessage({
          threadId,
          role: "assistant",
          content: "Here's what I made:",
          image,
        });
        setStreaming(false);
        return;
      }

      const history = store.getMessages(threadId).map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));
      const memories = store.getMemories().map((m) => m.content);
      const { provider, model } = parseModelId(s.selectedModelId);
      const providerConfig = { provider, model, apiKey: s.keys[provider] };

      const r = await (await import("@/lib/authed-fetch")).authedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          memories,
          mode,
          provider: providerConfig,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(await r.text());

      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreamText(full.replace(/\[remember:[^\]]+\]/gi, "").trim());
      }

      const memMatch = full.match(/\[remember:\s*([^\]]+)\]/i);
      const clean = full.replace(/\[remember:[^\]]+\]/gi, "").trim();
      if (clean) store.addMessage({ threadId, role: "assistant", content: clean });
      if (memMatch) store.addMemory(memMatch[1].trim());
    } catch (e: any) {
      if (e.name !== "AbortError") toast.error(e.message || "Something went wrong");
    } finally {
      setStreaming(false);
      setStreamText("");
      abortRef.current = null;
      setTimeout(() => textareaRef.current?.focus(), 40);
    }
  }, [input, pending, streaming, threadId, mode, s.selectedModelId, s.keys]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) {
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name} is too large (max 8 MB)`);
        continue;
      }
      try {
        const att = await fileToAttachment(f);
        setPending((p) => [...p, att]);
      } catch {
        toast.error(`Could not read ${f.name}`);
      }
    }
  }

  async function toggleRec() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 2000) {
          toast.error("Recording too short");
          setRecording(false);
          return;
        }
        const ext = rec.mimeType.includes("mp4") ? "mp4" : "webm";
        const fd = new FormData();
        fd.append("file", blob, `recording.${ext}`);
        const resp = await (await import("@/lib/authed-fetch")).authedFetch("/api/stt", { method: "POST", body: fd });
        setRecording(false);
        if (!resp.ok) {
          toast.error(await resp.text());
          return;
        }
        const j = (await resp.json()) as { text: string };
        setInput((prev) => (prev ? `${prev} ${j.text}` : j.text));
        textareaRef.current?.focus();
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied");
    }
  }

  async function speak(text: string) {
    const r = await (await import("@/lib/authed-fetch")).authedFetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: s.voice }),
    });
    if (!r.ok) {
      toast.error(await r.text());
      return;
    }
    const blob = await r.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    audio.play();
  }

  const showEmpty = messages.length === 0 && !streaming;

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-1">
          <ModeChip active={mode === "chat"} onClick={() => setMode("chat")} icon={<MessageSquare size={12} />} label="Chat" />
          <ModeChip active={mode === "research"} onClick={() => setMode("research")} icon={<Search size={12} />} label="Research" />
          <ModeChip active={mode === "code"} onClick={() => setMode("code")} icon={<Code2 size={12} />} label="Code" />
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <Cpu size={11} className="text-primary" />
            <span className="max-w-40 truncate">{currentModel?.label ?? s.selectedModelId}</span>
          </Link>
          <button
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
            }
            className="hidden items-center gap-1 rounded-full border border-border px-2 py-1 text-muted-foreground hover:bg-accent md:flex"
            title="Command palette"
          >
            <CommandIcon size={11} /> K
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          {showEmpty && <EmptyState onPick={(p) => setInput(p)} mode={mode} />}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onSpeak={speak} />
          ))}
          {streaming && streamText && (
            <MessageBubble
              msg={{
                id: "streaming",
                threadId,
                role: "assistant",
                content: streamText,
                createdAt: Date.now(),
              }}
              onSpeak={speak}
              streaming
            />
          )}
          {streaming && !streamText && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground animate-fade-in-up">
              <Sparkles size={14} className="text-primary animate-pulse" /> Baby is thinking…
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/60 bg-background/50 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-4">
          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((a, i) => (
                <div key={i} className="surface flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
                  {a.mimeType.startsWith("image/") ? <ImageIcon size={12} /> : <Paperclip size={12} />}
                  <span className="max-w-40 truncate">{a.name}</span>
                  <button
                    onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove attachment"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="surface flex items-end gap-2 rounded-2xl p-2"
          >
            <label className="cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Paperclip size={18} />
              <input
                type="file"
                multiple
                hidden
                onChange={onFile}
                accept="image/*,application/pdf,text/*"
              />
            </label>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                mode === "research"
                  ? "Ask a research question — Baby will cite sources…"
                  : mode === "code"
                    ? "Paste code, ask a coding question, or describe a feature…"
                    : "Ask Baby anything… (⌘K for commands, /image for pictures)"
              }
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={toggleRec}
              className={cn(
                "rounded-lg p-2 hover:bg-accent",
                recording ? "text-destructive animate-pulse" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Record voice"
            >
              {recording ? <Square size={18} /> : <Mic size={18} />}
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-xl bg-destructive p-2.5 text-destructive-foreground"
                aria-label="Stop"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && pending.length === 0}
                className="glow-ring rounded-xl bg-primary p-2.5 text-primary-foreground disabled:opacity-40"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            )}
          </form>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Baby can make mistakes. Conversations stay on this device.
          </p>
        </div>
      </div>
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 transition",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ onPick, mode }: { onPick: (p: string) => void; mode: Mode }) {
  const suggestions =
    mode === "research"
      ? [
          "What's new in AI safety research this month?",
          "Compare React Server Components vs Islands architecture with sources.",
          "Give me a briefing on longevity science, with citations.",
          "What are the strongest arguments for and against remote-first work?",
        ]
      : mode === "code"
        ? [
            "Write a debounce hook in TypeScript.",
            "Refactor this into smaller functions: (paste code)",
            "Explain this stack trace and suggest a fix.",
            "Set up a Postgres RLS policy for a multi-tenant app.",
          ]
        : [
            "Plan a productive week for me",
            "Explain a hard concept simply",
            "/image a cozy reading nook at golden hour",
            "Summarize the file I'll attach",
          ];
  return (
    <div className="mt-16 animate-fade-in-up text-center">
      <div className="mx-auto mb-4 h-14 w-14">
        <div className="h-14 w-14 rounded-full bg-primary animate-pulse-glow" />
      </div>
      <h1 className="display text-5xl">
        Hi, I'm <span className="text-gradient italic">Baby</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        {mode === "research" && "Ask me anything — I'll dig in and cite sources."}
        {mode === "code" && "Your coding copilot. Paste code, ask, ship."}
        {mode === "chat" && "What are we working on today?"}
      </p>
      <div className="mx-auto mt-8 grid max-w-lg gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="surface rounded-xl px-4 py-3 text-left text-sm hover:bg-accent/40 transition"
          >
            {s}
          </button>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Tip: press <kbd className="rounded bg-muted px-1.5 py-0.5">⌘K</kbd> anytime.
      </p>
    </div>
  );
}

function MessageBubble({
  msg,
  onSpeak,
  streaming,
}: {
  msg: Msg;
  onSpeak: (text: string) => void;
  streaming?: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("group mt-6 flex gap-3 animate-fade-in-up", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-primary/90" />}
      <div className={cn("max-w-[85%] rounded-2xl", isUser ? "bg-primary px-4 py-2.5 text-primary-foreground" : "text-foreground")}>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {msg.attachments.map((a, i) =>
              a.mimeType.startsWith("image/") ? (
                <img key={i} src={a.url} alt={a.name} className="max-h-48 rounded-lg" />
              ) : (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-black/10 px-2 py-1 text-xs">
                  <Paperclip size={12} />
                  {a.name}
                </div>
              ),
            )}
          </div>
        )}
        {msg.image && <img src={msg.image} alt="" className="mb-2 max-h-96 rounded-xl" />}
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
        ) : (
          <div className="prose-baby text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />
            )}
          </div>
        )}
        {!isUser && !streaming && msg.content && (
          <div className="mt-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => onSpeak(msg.content)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Speak"
            >
              <Volume2 size={12} /> Read aloud
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
