import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Square, X, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { store } from "@/lib/local-store";
import { parseModelId, settings, useSettings } from "@/lib/settings-store";

export const Route = createFileRoute("/voice")({
  ssr: false,
  component: VoicePage,
});

type Turn = { role: "user" | "assistant"; text: string };

function VoicePage() {
  const s = useSettings();
  const [state, setState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLive] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    return () => stopAll();
  }, []);

  function stopAll() {
    audioRef.current?.pause();
    recRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  async function startListening() {
    if (state === "listening") return;
    if (state === "speaking") audioRef.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let quietSince = 0;
      let sawVoice = false;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(rms);
        const now = performance.now();
        if (rms > 0.04) {
          sawVoice = true;
          quietSince = now;
        } else if (sawVoice && now - quietSince > 1200) {
          // 1.2s of silence after speaking → auto-stop
          finishListening();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = onRecStopped;
      recRef.current = rec;
      rec.start();
      setState("listening");
    } catch {
      toast.error("Microphone permission denied");
    }
  }

  function finishListening() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    recRef.current?.stop();
  }

  async function onRecStopped() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setLevel(0);
    const rec = recRef.current;
    const blob = new Blob(chunksRef.current, { type: rec?.mimeType || "audio/webm" });
    if (blob.size < 2500) {
      setState("idle");
      return;
    }
    setState("thinking");
    try {
      const ext = rec?.mimeType.includes("mp4") ? "mp4" : "webm";
      const fd = new FormData();
      fd.append("file", blob, `recording.${ext}`);
      const sttR = await (await import("@/lib/authed-fetch")).authedFetch("/api/stt", { method: "POST", body: fd });
      if (!sttR.ok) throw new Error(await sttR.text());
      const { text } = (await sttR.json()) as { text: string };
      const userText = text.trim();
      if (!userText) {
        setState("idle");
        return;
      }
      const nextTurns: Turn[] = [...turns, { role: "user", text: userText }];
      setTurns(nextTurns);
      setLive("");

      const { provider, model } = parseModelId(s.selectedModelId);
      const providerConfig = { provider, model, apiKey: s.keys[provider] };
      const history = nextTurns.map((t) => ({ role: t.role, content: t.text }));
      const memories = store.getMemories().map((m) => m.content);

      const r = await (await import("@/lib/authed-fetch")).authedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          memories,
          mode: "voice",
          provider: providerConfig,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        setLive(full);
      }
      const clean = full.replace(/\[remember:[^\]]+\]/gi, "").trim();
      setTurns((prev) => [...prev, { role: "assistant", text: clean }]);
      setLive("");
      await speak(clean);
      // Auto-resume listening for hands-free flow.
      startListening();
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
      setState("idle");
    }
  }

  async function speak(text: string) {
    if (!text) return;
    setState("speaking");
    try {
      const r = await (await import("@/lib/authed-fetch")).authedFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: s.voice }),
      });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
    } finally {
      setState("idle");
    }
  }

  const orbState = state;
  const scale = 1 + Math.min(level * 3, 0.5);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6">
      <Link
        to="/chat"
        className="absolute top-6 right-6 flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      >
        <X size={12} /> Close
      </Link>

      <div className="flex flex-col items-center gap-8 text-center">
        <div
          className={cn(
            "relative flex h-56 w-56 items-center justify-center rounded-full transition-transform",
            orbState === "listening" && "animate-pulse-glow",
          )}
          style={{ transform: `scale(${scale})` }}
        >
          <div className="absolute inset-0 rounded-full bg-primary opacity-30 blur-3xl" />
          <div className="relative h-40 w-40 rounded-full bg-gradient-to-br from-primary to-primary/60 shadow-2xl" />
        </div>

        <div className="min-h-16 max-w-xl text-lg">
          {orbState === "idle" && !turns.length && (
            <p className="text-muted-foreground">Tap the mic and talk to Baby.</p>
          )}
          {orbState === "listening" && <p className="text-primary">Listening…</p>}
          {orbState === "thinking" && <p className="text-muted-foreground">Thinking…</p>}
          {orbState === "speaking" && (
            <p className="flex items-center justify-center gap-2 text-muted-foreground">
              <Volume2 size={16} /> Speaking…
            </p>
          )}
          {live && <p className="mt-3 text-sm text-muted-foreground italic">{live}</p>}
        </div>

        <div className="flex items-center gap-3">
          {orbState === "listening" ? (
            <button
              onClick={finishListening}
              className="flex items-center gap-2 rounded-full bg-destructive px-6 py-3 text-sm font-medium text-destructive-foreground"
            >
              <Square size={16} /> Stop
            </button>
          ) : (
            <button
              onClick={startListening}
              disabled={orbState === "thinking"}
              className="glow-ring flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Mic size={16} /> {turns.length ? "Speak again" : "Start talking"}
            </button>
          )}
        </div>

        {turns.length > 0 && (
          <div className="mt-6 max-h-48 w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card/50 p-4 text-left text-sm">
            {turns.slice(-6).map((t, i) => (
              <div key={i} className="mb-2">
                <span className={t.role === "user" ? "text-primary" : "text-muted-foreground"}>
                  {t.role === "user" ? "You" : "Baby"}:
                </span>{" "}
                {t.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
