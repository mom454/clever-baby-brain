// Local, private settings: BYO API keys, default model, feature toggles.
// Everything lives in localStorage — never leaves the device except when
// explicitly attached to an outgoing chat request the user triggers.

import { useSyncExternalStore } from "react";

export type Provider = "lovable" | "openai" | "anthropic" | "google" | "perplexity";
export type Mode = "chat" | "research" | "code";

export type ModelOption = {
  id: string;
  label: string;
  provider: Provider;
  hint?: string;
};

// Curated model list. Users can also type a custom model in Settings.
export const MODELS: ModelOption[] = [
  { id: "lovable:openai/gpt-5.5", label: "Baby (GPT-5.5)", provider: "lovable", hint: "Default · no key needed" },
  { id: "lovable:google/gemini-3.1-pro-preview", label: "Baby (Gemini 3.1 Pro)", provider: "lovable", hint: "Default · no key needed" },
  { id: "lovable:google/gemini-3.5-flash", label: "Baby (Gemini 3.5 Flash)", provider: "lovable", hint: "Fast · no key needed" },
  { id: "openai:gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "openai:gpt-4o-mini", label: "GPT-4o mini", provider: "openai" },
  { id: "openai:o1-mini", label: "o1-mini (reasoning)", provider: "openai" },
  { id: "anthropic:claude-opus-4-20250514", label: "Claude Opus 4", provider: "anthropic" },
  { id: "anthropic:claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
  { id: "anthropic:claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", provider: "anthropic" },
  { id: "google:gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
  { id: "perplexity:sonar-pro", label: "Perplexity Sonar Pro", provider: "perplexity", hint: "Live web + citations" },
  { id: "perplexity:sonar", label: "Perplexity Sonar", provider: "perplexity", hint: "Live web + citations" },
];

export type Settings = {
  selectedModelId: string;
  keys: Partial<Record<Provider, string>>;
  voice: string; // TTS voice id
  autoTts: boolean; // voice-mode replies out loud automatically
};

const KEY = "baby.settings.v1";
const DEFAULT: Settings = {
  selectedModelId: "lovable:openai/gpt-5.5",
  keys: {},
  voice: "alloy",
  autoTts: false,
};

let snapshot: Settings | null = null;
const listeners = new Set<() => void>();

function read(): Settings {
  if (typeof localStorage === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...(JSON.parse(raw) as Settings) };
  } catch {
    return DEFAULT;
  }
}

function emit() {
  snapshot = null;
  listeners.forEach((l) => l());
}

export const settings = {
  get(): Settings {
    if (!snapshot) snapshot = read();
    return snapshot;
  },
  set(patch: Partial<Settings>) {
    const next = { ...settings.get(), ...patch };
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
    emit();
  },
  setKey(provider: Provider, apiKey: string) {
    const next = { ...settings.get(), keys: { ...settings.get().keys, [provider]: apiKey.trim() || undefined } };
    if (!apiKey.trim()) delete next.keys[provider];
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
    emit();
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.get(),
    () => DEFAULT,
  );
}

export function getModel(id: string): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}

// Turn "provider:model" into { provider, model }.
export function parseModelId(id: string): { provider: Provider; model: string } {
  const [p, ...rest] = id.split(":");
  return { provider: (p as Provider) || "lovable", model: rest.join(":") };
}
