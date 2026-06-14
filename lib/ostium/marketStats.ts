/**
 * 24h per-pair stats (price change + traded volume) for the markets table.
 *
 * These are heavier reads than the live price tick, so they're computed in the
 * background and cached: callers get whatever is cached *immediately* (empty on
 * first hit) and a refresh is kicked off when stale - the table never blocks on
 * them. Volume = Σ fill notional over 24h (all traders); change = hourly-candle
 * open(24h ago) → close(now).
 */
import { getReader } from "./clients.ts";
import { listPairs } from "./read.ts";
import { withRpcRetry } from "../rpc.ts";

export interface PairStat {
  change24h: number | null; // percent, e.g. -1.23
  volume24h: string | null; // USD notional
}

const TTL_MS = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CANDLE_POOL = 8; // concurrent getCandles calls

let cache: { at: number; stats: Map<string, PairStat> } | null = null;
let inflight: Promise<void> | null = null;

async function compute(): Promise<Map<string, PairStat>> {
  const reader = await getReader();
  const now = Date.now();
  const stats = new Map<string, PairStat>();

  // Volume: sum fill notional per pair over the last 24h (across all traders).
  const vol = new Map<string, number>();
  let haveVol = false;
  try {
    const fills = await withRpcRetry(() =>
      reader.getFillsByTime({ user: "ALL", startTime: now - DAY_MS, limit: 100_000 })
    );
    haveVol = true;
    for (const f of fills) {
      const n = Number(f.ntl);
      if (Number.isFinite(n)) vol.set(f.pairId, (vol.get(f.pairId) ?? 0) + n);
    }
  } catch {
    // leave volume null
  }

  // Change: hourly candles over the last ~25h; first open → last close.
  const pairs = await listPairs();
  const change = new Map<string, number | null>();
  for (let i = 0; i < pairs.length; i += CANDLE_POOL) {
    await Promise.all(pairs.slice(i, i + CANDLE_POOL).map(async (p) => {
      try {
        const candles = await withRpcRetry(() =>
          reader.getCandles({
            pairId: p.pairId,
            from: now - DAY_MS - 60 * 60 * 1000,
            to: now,
            resolution: "60",
          })
        );
        if (candles.length >= 2) {
          const first = candles[0].open;
          const last = candles[candles.length - 1].close;
          change.set(p.pairId, first > 0 ? ((last - first) / first) * 100 : null);
        } else {
          change.set(p.pairId, null);
        }
      } catch {
        change.set(p.pairId, null);
      }
    }));
  }

  for (const p of pairs) {
    stats.set(p.pairId, {
      change24h: change.get(p.pairId) ?? null,
      volume24h: haveVol ? String(vol.get(p.pairId) ?? 0) : null,
    });
  }
  return stats;
}

function refreshInBackground(): void {
  if (inflight) return;
  inflight = compute()
    .then((stats) => {
      cache = { at: Date.now(), stats };
    })
    .catch(() => {/* keep stale cache; try again next tick */})
    .finally(() => {
      inflight = null;
    });
}

/**
 * Non-blocking: returns the current cached stats (empty until the first compute
 * finishes) and triggers a background refresh when stale or missing.
 */
export function getMarketStats(): Map<string, PairStat> {
  if (!cache || Date.now() - cache.at >= TTL_MS) refreshInBackground();
  return cache?.stats ?? new Map();
}
