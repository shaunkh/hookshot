/**
 * Tiny per-User pub/sub for live dashboard updates (SSE). In-process only — the
 * app runs as a single process, so a Map of listener sets is sufficient.
 */
export interface SignalEvent {
  type: "signal";
  id: string;
  status: string;
  reason?: string;
}

type Listener = (ev: SignalEvent) => void;

const subscribers = new Map<string, Set<Listener>>();

export function subscribe(userId: string, fn: Listener): () => void {
  let set = subscribers.get(userId);
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) subscribers.delete(userId);
  };
}

export function emit(userId: string, ev: SignalEvent): void {
  const set = subscribers.get(userId);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(ev);
    } catch {
      // a broken listener must not break the worker
    }
  }
}
