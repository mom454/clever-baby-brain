// Server-only guard for AI proxy routes.
//
// The AI proxy endpoints (/api/chat, /api/image, /api/stt, /api/tts) attach
// a server-held LOVABLE_API_KEY when calling the Lovable AI Gateway. Without
// a check any internet visitor could drain paid credits by hitting these
// routes directly. This helper enforces two things before the proxy runs:
//
//   1. A valid Supabase user session (Authorization: Bearer <access_token>).
//   2. A simple per-user + per-IP sliding-window rate limit.
//
// The Supabase JWT is validated using the same publishable-key pattern as
// the generated auth middleware.

import { createClient } from "@supabase/supabase-js";

type GuardOk = { ok: true; userId: string };
type GuardErr = { ok: false; response: Response };
export type GuardResult = GuardOk | GuardErr;

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

// Sliding-window rate limits kept in memory. This is per-instance and
// intentionally small — enough to stop trivial abuse without needing a
// shared store.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_USER = 30; // requests per minute
const buckets = new Map<string, number[]>();

function rateLimited(key: string, limit = RATE_LIMIT_PER_USER): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return true;
  }
  arr.push(now);
  buckets.set(key, arr);
  // opportunistic GC
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      const filtered = v.filter((t) => now - t < RATE_WINDOW_MS);
      if (filtered.length === 0) buckets.delete(k);
      else buckets.set(k, filtered);
    }
  }
  return false;
}

export async function requireAuthAndRateLimit(request: Request): Promise<GuardResult> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return {
      ok: false,
      response: new Response("Server auth not configured", { status: 500 }),
    };
  }

  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }
  const token = auth.slice(7).trim();
  if (!token || token.split(".").length !== 3) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }

  if (rateLimited(`u:${userId}`)) {
    return {
      ok: false,
      response: new Response("Rate limited. Please slow down.", { status: 429 }),
    };
  }

  return { ok: true, userId };
}
