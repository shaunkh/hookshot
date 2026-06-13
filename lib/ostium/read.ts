/**
 * Read-side helpers over the shared Ostium reader: pair + price caches, symbol
 * resolution, and the Slot views that the aggregation/allocation logic consumes.
 * All network calls are wrapped in withRpcRetry for rate-limit resilience.
 *
 * (Absorbs the read-only demo that previously lived in src/main.ts.)
 */
import type { OpenOrder, Pair } from "@ostium/builder-sdk";
import type { Address } from "viem";
import { getReader } from "./clients.ts";
import { withRpcRetry } from "../rpc.ts";
import { parseSymbol } from "../format.ts";
import type { Side } from "../types.ts";
import type { SlotSize } from "./pricing.ts";

export interface PriceTriple {
  ask: string;
  bid: string;
  mid: string;
}

const PAIRS_TTL_MS = 30_000;
const PRICES_TTL_MS = 2_000;

let pairsCache: { at: number; pairs: Pair[] } | null = null;
let pricesCache: { at: number; prices: Record<string, PriceTriple> } | null = null;

export async function listPairs(): Promise<Pair[]> {
  const now = Date.now();
  if (pairsCache && now - pairsCache.at < PAIRS_TTL_MS) return pairsCache.pairs;
  const reader = await getReader();
  const { pairs } = await withRpcRetry(() => reader.getPairs());
  pairsCache = { at: now, pairs };
  return pairs;
}

/** Resolve a "BTC/USD" symbol to its Pair via the cached pair list. */
export async function resolvePair(symbol: string): Promise<Pair | undefined> {
  const parsed = parseSymbol(symbol);
  if (!parsed) return undefined;
  const list = await listPairs();
  return list.find(
    (p) => p.pairFrom.toUpperCase() === parsed.from && p.pairTo.toUpperCase() === parsed.to,
  );
}

async function allPrices(): Promise<Record<string, PriceTriple>> {
  const now = Date.now();
  if (pricesCache && now - pricesCache.at < PRICES_TTL_MS) return pricesCache.prices;
  const reader = await getReader();
  const { prices } = await withRpcRetry(() => reader.getAllPrices());
  pricesCache = { at: now, prices };
  return prices;
}

export async function livePrice(pairId: string): Promise<PriceTriple> {
  const p = (await allPrices())[pairId];
  if (!p) throw new Error(`no live price for pair ${pairId}`);
  return p;
}

/** Open Slots for one pair + direction, reduced to what allocation needs. */
export async function getSlots(trader: string, pairId: string, side: Side): Promise<SlotSize[]> {
  const reader = await getReader();
  const { pairPositions } = await withRpcRetry(() =>
    reader.getOpenPositions({ user: trader as Address })
  );
  return pairPositions
    .map((pp) => pp.position)
    .filter((p) => p.pairId === pairId && p.side === side)
    .map((p) => ({ idx: p.idx, szi: p.szi, collateralUsed: p.collateralUsed }));
}

/** Open limit/stop orders for one pair + direction (optionally a single type). */
export async function getOpenLimitOrders(
  trader: string,
  pairId: string,
  side: Side,
  orderType?: "limit" | "stop",
): Promise<OpenOrder[]> {
  const reader = await getReader();
  const orders = await withRpcRetry(() => reader.getOpenOrders({ user: trader as Address }));
  return orders.filter(
    (o) =>
      o.pairId === pairId &&
      o.side === side &&
      (!orderType || o.orderType.toLowerCase() === orderType),
  );
}
