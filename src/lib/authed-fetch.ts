// Browser helper: attach the current Supabase access token to app API calls.
// The AI proxy routes reject requests without a valid Bearer token.
import { supabase } from "@/integrations/supabase/client";

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
