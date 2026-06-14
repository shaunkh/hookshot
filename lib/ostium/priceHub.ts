/**
 * Shared live-price hub. The server holds ONE Ostium price-stream websocket
 * (`reader.streamPrices`) for all pairs, keeps the latest tick per pair in
 * memory, and fans changes out to SSE subscribers - coalesced to one flush per
 * second so a chatty feed can't flood browsers. Lazily started on first
 * subscriber; auto-reconnects while any subscriber remains.
 *
 * In-process only, like the signal event bus: the app runs as a single process.
 */
import type { PriceTick } from "@ostium/builder-sdk";
import { getReader } from "./clients.ts";
import { listPairs } from "./read.ts";

export interface PricePoint {
  pairId: string;
  bid: string;
  mid: string;
  ask: string;
  isMarketOpen: boolean;
}

type Listener = (points: PricePoint[]) => void;

const latest = new Map<string, PricePoint>();
const listeners = new Set<Listener>();
let dirty = new Set<string>();
let nameToId = new Map<string, string>();
let stream: { close(): void } | null = null;
let flush: ReturnType<typeof setInterval> | undefined;
let startPromise: Promise<void> | null = null;

function ingest(t: PriceTick): void {
  const pairId = t.pairId ?? nameToId.get(`${t.from}/${t.to}`);
  if (!pairId) return;
  latest.set(pairId, {
    pairId,
    bid: String(t.bid),
    mid: String(t.mid),
    ask: String(t.ask),
    isMarketOpen: t.isMarketOpen,
  });
  dirty.add(pairId);
}

function flushTick(): void {
  if (dirty.size === 0 || listeners.size === 0) return;
  const points = [...dirty].map((id) => latest.get(id)).filter((p): p is PricePoint => !!p);
  dirty = new Set();
  for (const fn of [...listeners]) {
    try {
      fn(points);
    } catch {
      // a broken listener must not break the hub
    }
  }
}

async function start(): Promise<void> {
  const pairs = await listPairs();
  nameToId = new Map(pairs.map((p) => [`${p.pairFrom}/${p.pairTo}`, p.pairId]));
  const reader = await getReader();
  const s = reader.streamPrices(pairs.map((p) => p.pairId));
  stream = s;
  s.onSnapshot((ts) => ts.forEach(ingest));
  s.onTick(ingest);
  s.onError(() => {/* transient; onClose handles reconnect */});
  s.onClose(() => {
    stream = null;
    startPromise = null; // allow a fresh connection
    if (listeners.size > 0) {
      setTimeout(() => ensureStarted().catch(() => {}), 2000); // reconnect while watched
    }
  });
  if (!flush) flush = setInterval(flushTick, 1000);
}

function ensureStarted(): Promise<void> {
  return (startPromise ??= start().catch((e) => {
    startPromise = null; // let the next subscriber retry
    throw e;
  }));
}

/**
 * Subscribe to coalesced (1/s) price updates. Immediately replays the current
 * snapshot. Returns an unsubscribe function. Resolves once the stream is up;
 * rejects if it can't start (caller should fall back to REST polling).
 */
export async function subscribePrices(fn: Listener): Promise<() => void> {
  await ensureStarted();
  listeners.add(fn);
  const snapshot = [...latest.values()];
  if (snapshot.length > 0) {
    try {
      fn(snapshot);
    } catch {
      // ignore
    }
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && stream) {
      stream.close(); // drop the upstream WS when nobody is watching
      stream = null;
      startPromise = null;
    }
  };
}
