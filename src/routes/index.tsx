import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, MessageCircle, Image, Mic, FileText, BrainCircuit } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/chat" });
  },
  component: Landing,
});

function Feature({ icon: Icon, title, desc }: { icon: typeof Sparkles; title: string; desc: string }) {
  return (
    <div className="surface rounded-2xl p-5">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon size={20} />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-primary animate-pulse-glow" />
            <div className="absolute inset-0 h-8 w-8 rounded-full bg-primary blur-md opacity-60" />
          </div>
          <span className="display text-2xl">Baby</span>
        </div>
        <Link to="/auth" className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-accent">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <section className="mx-auto max-w-3xl text-center animate-fade-in-up">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles size={12} className="text-primary" /> Your personal AI, always at your side
          </div>
          <h1 className="display text-6xl leading-[1.05] sm:text-7xl md:text-8xl">
            Meet <span className="text-gradient italic">Baby</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            A warm, powerful AI that chats, listens, sees, and remembers.
            One place for thinking, creating, and getting things done.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth" className="glow-ring rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90">
              Start chatting
            </Link>
            <a href="#features" className="rounded-full border border-border bg-card px-6 py-3 font-medium hover:bg-accent">
              See what Baby does
            </a>
          </div>
        </section>

        <section id="features" className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={MessageCircle} title="Streaming chat" desc="Fast, thoughtful conversations with markdown, code, and multiple models." />
          <Feature icon={Mic} title="Voice conversations" desc="Talk to Baby out loud. Baby transcribes, thinks, and replies in a natural voice." />
          <Feature icon={Image} title="Image generation" desc="Create and refine images from a prompt, right inside the chat." />
          <Feature icon={FileText} title="Files & documents" desc="Drop in PDFs, images or text and ask Baby to read, summarize, or extract." />
          <Feature icon={BrainCircuit} title="Personal memory" desc="Baby remembers what matters to you — and you stay in control of every memory." />
          <Feature icon={Sparkles} title="Multi-model" desc="Switch between the best models for the task. Everything through one clean interface." />
        </section>
      </main>
    </div>
  );
}
