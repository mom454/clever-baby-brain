import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Paperclip, Mic, Image as ImageIcon, Loader2, Sparkles, Volume2, X, Square } from "lucide-react";
import { cn } from "@/lib/utils";

type Attachment = { url: string; mimeType: string; name: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; attachments?: Attachment[]; image?: string };

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export function ChatWindow({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [recording, setRecording] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [], refetch } = useQuery({
    queryKey: ["messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at", { ascending: true });
      if (error) throw error;
      return data.map((m: any) => ({
        id: m.id, role: m.role, content: m.message?.content ?? "",
        attachments: m.message?.attachments, image: m.message?.image,
      })) as Msg[];
    },
  });

  useEffect(() => { textareaRef.current?.focus(); }, [threadId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText]);

  const send = useCallback(async () => {
    const content = input.trim();
    if ((!content && pending.length === 0) || streaming) return;
    setInput(""); const atts = pending; setPending([]);
    setStreaming(true); setStreamText("");

    const token = await getToken();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // slash /image command
      if (content.startsWith("/image ")) {
        const prompt = content.slice(7).trim();
        // Optimistically insert user msg
        await supabase.from("messages").insert({
          thread_id: threadId, user_id: (await supabase.auth.getUser()).data.user!.id,
          role: "user", message: { content },
        });
        qc.invalidateQueries({ queryKey: ["messages", threadId] });

        const r = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ prompt, referenceUrl: atts[0]?.url }),
        });
        if (!r.ok) throw new Error(await r.text());
        const { image } = await r.json();
        await supabase.from("messages").insert({
          thread_id: threadId, user_id: (await supabase.auth.getUser()).data.user!.id,
          role: "assistant", message: { content: `Here's what I made:`, image },
        });
        qc.invalidateQueries({ queryKey: ["messages", threadId] });
        qc.invalidateQueries({ queryKey: ["threads"] });
        setStreaming(false);
        return;
      }

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ threadId, message: { content, attachments: atts } }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(await r.text());
      qc.invalidateQueries({ queryKey: ["messages", threadId] });

      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreamText(acc.replace(/\[remember:[^\]]+\]/gi, "").trim());
      }
    } catch (e: any) {
      if (e.name !== "AbortError") toast.error(e.message || "Something went wrong");
    } finally {
      setStreaming(false); setStreamText("");
      refetch();
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["memories"] });
      abortRef.current = null;
      setTimeout(() => textareaRef.current?.focus(), 40);
    }
  }, [input, pending, streaming, threadId, qc, refetch]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    for (const f of files) {
      const path = `${user.id}/${crypto.randomUUID()}-${f.name}`;
      const { error } = await supabase.storage.from("baby-uploads").upload(path, f);
      if (error) { toast.error(error.message); continue; }
      const { data } = await supabase.storage.from("baby-uploads").createSignedUrl(path, 60 * 60 * 24);
      if (data) setPending((p) => [...p, { url: data.signedUrl, mimeType: f.type || "application/octet-stream", name: f.name }]);
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
        if (blob.size < 2000) { toast.error("Recording too short"); setRecording(false); return; }
        const ext = (rec.mimeType.includes("mp4") ? "mp4" : "webm");
        const fd = new FormData();
        fd.append("file", blob, `recording.${ext}`);
        const token = await getToken();
        const resp = await fetch("/api/stt", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        setRecording(false);
        if (!resp.ok) { toast.error(await resp.text()); return; }
        const j = await resp.json();
        setInput((prev) => prev ? `${prev} ${j.text}` : j.text);
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
    const token = await getToken();
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) { toast.error(await r.text()); return; }
    const blob = await r.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    audio.play();
  }

  const showEmpty = messages.length === 0 && !streaming;

  return (
    <div className="relative flex h-full flex-col">
      <div ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          {showEmpty && <EmptyState onPick={(p) => setInput(p)} />}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onSpeak={speak} />
          ))}
          {streaming && streamText && (
            <MessageBubble msg={{ id: "streaming", role: "assistant", content: streamText }} onSpeak={speak} streaming />
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
                  <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="surface flex items-end gap-2 rounded-2xl p-2"
          >
            <label className="cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Paperclip size={18} />
              <input type="file" multiple hidden onChange={onFile} accept="image/*,application/pdf,text/*" />
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
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Ask Baby anything… (try /image sunset over mountains)"
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            />
            <button
              type="button" onClick={toggleRec}
              className={cn("rounded-lg p-2 hover:bg-accent", recording ? "text-destructive animate-pulse" : "text-muted-foreground hover:text-foreground")}
              aria-label="Record voice"
            >
              {recording ? <Square size={18} /> : <Mic size={18} />}
            </button>
            {streaming ? (
              <button
                type="button" onClick={() => abortRef.current?.abort()}
                className="rounded-xl bg-destructive p-2.5 text-destructive-foreground"
                aria-label="Stop"
              ><Square size={16} /></button>
            ) : (
              <button
                type="submit" disabled={!input.trim() && pending.length === 0}
                className="glow-ring rounded-xl bg-primary p-2.5 text-primary-foreground disabled:opacity-40"
                aria-label="Send"
              ><Send size={16} /></button>
            )}
          </form>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Baby can make mistakes. Verify important information.</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (p: string) => void }) {
  const suggestions = [
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
      <h1 className="display text-5xl">Hi, I'm <span className="text-gradient italic">Baby</span></h1>
      <p className="mt-3 text-muted-foreground">What are we working on today?</p>
      <div className="mx-auto mt-8 grid max-w-lg gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button key={s} onClick={() => onPick(s)}
            className="surface rounded-xl px-4 py-3 text-left text-sm hover:bg-accent/40 transition">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg, onSpeak, streaming }: { msg: Msg; onSpeak: (text: string) => void; streaming?: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("group mt-6 flex gap-3 animate-fade-in-up", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-primary/90" />
      )}
      <div className={cn("max-w-[85%] rounded-2xl", isUser ? "bg-primary px-4 py-2.5 text-primary-foreground" : "text-foreground")}>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {msg.attachments.map((a, i) =>
              a.mimeType.startsWith("image/") ? (
                <img key={i} src={a.url} alt={a.name} className="max-h-48 rounded-lg" />
              ) : (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-black/10 px-2 py-1 text-xs"><Paperclip size={12} />{a.name}</div>
              )
            )}
          </div>
        )}
        {msg.image && <img src={msg.image} alt="" className="mb-2 max-h-96 rounded-xl" />}
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
        ) : (
          <div className="prose-baby text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />}
          </div>
        )}
        {!isUser && !streaming && msg.content && (
          <div className="mt-1 opacity-0 transition group-hover:opacity-100">
            <button onClick={() => onSpeak(msg.content)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent" aria-label="Speak">
              <Volume2 size={12} /> Read aloud
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
