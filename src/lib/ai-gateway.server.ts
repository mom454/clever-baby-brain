// Server-only AI Gateway helpers.
export const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

export function getLovableApiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

export async function gatewayFetch(path: string, init: RequestInit) {
  const key = getLovableApiKey();
  return fetch(`${AI_GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${key}`,
    },
  });
}
