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

// Cached snapshots so useSyncExternalStore sees stable references between changes.
let threadsSnapshot: Thread[] | null = null;
const msgsSnapshot = new Map<string, Msg[]>();
let memoriesSnapshot: Memory[] | null = null;
const listeners = new Set<() => void>();

function invalidate(key: string) {
  if (key === "*" || key === K.threads) threadsSnapshot = null;
  if (key === "*" || key === K.mems) memoriesSnapshot = null;
  if (key === "*") msgsSnapshot.clear();
  else if (key.startsWith("baby.msgs.v1.")) msgsSnapshot.delete(key.slice("baby.msgs.v1.".length));
  listeners.forEach((l) => l());
}

function write(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  invalidate(key);
}

export function subscribeStore(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => invalidate(e.key ?? "*");
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
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
    if (!threadsSnapshot) {
      threadsSnapshot = read<Thread[]>(K.threads, [])
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return threadsSnapshot;
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
    let cached = msgsSnapshot.get(threadId);
    if (!cached) {
      cached = read<Msg[]>(K.msgs(threadId), []);
      msgsSnapshot.set(threadId, cached);
    }
    return cached;
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
