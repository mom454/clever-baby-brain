import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/chat" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e, session) => {
      if (session && (e === "SIGNED_IN" || e === "INITIAL_SESSION")) {
        navigate({ to: "/chat", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { name },
          },
        });
        if (error) throw error;
        toast.success("Welcome to Baby ✨");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    setLoading(true);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res.error) {
      toast.error(res.error.message ?? "Google sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 inline-flex items-center gap-2">
            <div className="relative h-10 w-10">
              <div className="h-10 w-10 rounded-full bg-primary animate-pulse-glow" />
              <div className="absolute inset-0 h-10 w-10 rounded-full bg-primary blur-lg opacity-70" />
            </div>
          </div>
          <h1 className="display text-4xl">{mode === "signin" ? "Welcome back" : "Say hi to Baby"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to keep the conversation going." : "Create an account to get started."}
          </p>
        </div>

        <div className="surface rounded-2xl p-6">
          <button
            onClick={google}
            disabled={loading}
            className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.62 0 3.09.55 4.24 1.63l3.15-3.15C17.45 1.72 14.94.5 12 .5 7.31.5 3.26 3.19 1.28 7.09l3.66 2.84C5.94 6.84 8.7 5 12 5z"/><path fill="#4285F4" d="M23.49 12.28c0-.83-.08-1.63-.22-2.4H12v4.55h6.44c-.28 1.5-1.13 2.77-2.4 3.62v3.02h3.88c2.27-2.09 3.57-5.17 3.57-8.79z"/><path fill="#FBBC05" d="M4.94 14.09A7.51 7.51 0 014.5 12c0-.73.13-1.43.35-2.09L1.19 7.07A11.5 11.5 0 000 12c0 1.86.45 3.62 1.24 5.17l3.7-3.08z"/><path fill="#34A853" d="M12 23.5c3.24 0 5.95-1.08 7.93-2.92l-3.88-3.02c-1.08.72-2.45 1.14-4.05 1.14-3.3 0-6.06-1.84-7.06-4.43l-3.7 3.08C3.26 20.81 7.31 23.5 12 23.5z"/></svg>
            Continue with Google
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <input
                type="text" placeholder="Your name" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-border bg-input/40 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            <input
              type="email" required placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-input/40 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="password" required placeholder="Password" value={password} minLength={6}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-input/40 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit" disabled={loading}
              className="glow-ring flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-primary hover:underline"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
