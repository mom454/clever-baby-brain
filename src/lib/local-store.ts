// Client-side persistent store for Baby.
// Everything lives in the user's browser (localStorage). No accounts, no cloud sync.

export type Attachment = { url: string; mimeType: string; name: string };
export type Role = "user" | "assistant";
export type Thread = { id: string; title: string; updatedAt: number };
export type Msg = {
  id: string;
  threadId: string;
  role: Role;
  content: string;
  attachments?: Attachment[];
  image?: string;
  createdAt: number;
};
export type Memory = { id: string; content: string; createdAt: number };

const K = {
  threads: "baby.threads.v1",
  msgs: (t: string) => `baby.msgs.v1.${t}`,
  mems: "baby.memories.v1",
};

const STORE_EVENT = "baby-store-change";

function read<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { key } }));
}

export function subscribeStore(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(STORE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(STORE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const store = {
  // Threads
  getThreads(): Thread[] {
    return read<Thread[]>(K.threads, []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  },
  getThread(threadId: string): Thread | null {
    return store.getThreads().find((t) => t.id === threadId) ?? null;
  },
  createThread(title = "New chat"): Thread {
    const t: Thread = { id: id(), title, updatedAt: Date.now() };
    write(K.threads, [t, ...read<Thread[]>(K.threads, [])]);
    return t;
  },
  updateThread(threadId: string, patch: Partial<Thread>) {
    const next = read<Thread[]>(K.threads, []).map((t) =>
      t.id === threadId ? { ...t, ...patch } : t,
    );
    write(K.threads, next);
  },
  deleteThread(threadId: string) {
    write(
      K.threads,
      read<Thread[]>(K.threads, []).filter((t) => t.id !== threadId),
    );
    if (typeof localStorage !== "undefined") localStorage.removeItem(K.msgs(threadId));
  },

  // Messages
  getMessages(threadId: string): Msg[] {
    return read<Msg[]>(K.msgs(threadId), []);
  },
  addMessage(m: Omit<Msg, "id" | "createdAt">): Msg {
    const msg: Msg = { ...m, id: id(), createdAt: Date.now() };
    write(K.msgs(m.threadId), [...store.getMessages(m.threadId), msg]);
    store.updateThread(m.threadId, { updatedAt: Date.now() });
    return msg;
  },
  updateMessage(threadId: string, messageId: string, patch: Partial<Msg>) {
    const next = store.getMessages(threadId).map((m) =>
      m.id === messageId ? { ...m, ...patch } : m,
    );
    write(K.msgs(threadId), next);
  },

  // Memories
  getMemories(): Memory[] {
    return read<Memory[]>(K.mems, []).slice().sort((a, b) => b.createdAt - a.createdAt);
  },
  addMemory(content: string): Memory {
    const m: Memory = { id: id(), content, createdAt: Date.now() };
    write(K.mems, [m, ...read<Memory[]>(K.mems, [])]);
    return m;
  },
  deleteMemory(memoryId: string) {
    write(K.mems, read<Memory[]>(K.mems, []).filter((m) => m.id !== memoryId));
  },
  clearAll() {
    if (typeof localStorage === "undefined") return;
    for (const t of read<Thread[]>(K.threads, [])) localStorage.removeItem(K.msgs(t.id));
    localStorage.removeItem(K.threads);
    localStorage.removeItem(K.mems);
    window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: { key: "*" } }));
  },
};

export async function fileToAttachment(file: File): Promise<Attachment> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { url, mimeType: file.type || "application/octet-stream", name: file.name };
}
