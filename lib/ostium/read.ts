/**
 * Read-side helpers over the shared Ostium reader: pair + price caches, symbol
 * resolution, and the Slot views that the aggregation/allocation logic consumes.
 * All network calls are wrapped in withRpcRetry for rate-limit resilience.
 *
 * (Absorbs the read-only demo that previously lived in src/main.ts.)
 */
import type { OpenOrder, Order, Pair } from "@ostium/builder-sdk";
import type { Address, Hex } from "viem";
import { getReader } from "./clients.ts";
import { getMarketStats } from "./marketStats.ts";
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

export interface Market {
  pairId: string;
  symbol: string; // e.g. "BTC/USD"
  category: string; // group name, e.g. "crypto", "forex"
  isMarketOpen: boolean;
  mid: string;
  bid: string;
  ask: string;
  maxLeverage: number;
  oiLong: string; // USD long open interest
  oiShort: string; // USD short open interest
  change24h: number | null; // percent
  volume24h: string | null; // USD notional traded in 24h
}

/**
 * All tradable markets with their live prices + 24h stats. The pair list (static
 * fields, market-open flag, OI) comes from the 30s pairs cache; bid/mid/ask are
 * overlaid from the 2s price cache; 24h change/volume from the (background,
 * non-blocking) stats cache. Sorted by 24h volume desc, then symbol.
 */
export async function listMarkets(): Promise<Market[]> {
  const pairs = await listPairs();
  let prices: Record<string, PriceTriple> = {};
  try {
    prices = await allPrices();
  } catch {
    // fall back to the prices embedded in the pair objects
  }
  const stats = getMarketStats();
  return pairs
    .map((p) => {
      const pr = prices[p.pairId];
      const st = stats.get(p.pairId);
      return {
        pairId: p.pairId,
        symbol: `${p.pairFrom}/${p.pairTo}`,
        category: p.category,
        isMarketOpen: p.isMarketOpen,
        mid: pr?.mid ?? p.midPx,
        bid: pr?.bid ?? p.bidPx,
        ask: pr?.ask ?? p.askPx,
        maxLeverage: p.maxLeverage,
        oiLong: p.buyOpenInterest,
        oiShort: p.sellOpenInterest,
        change24h: st?.change24h ?? null,
        volume24h: st?.volume24h ?? null,
      };
    })
    .sort((a, b) =>
      Number(b.volume24h ?? 0) - Number(a.volume24h ?? 0) || a.symbol.localeCompare(b.symbol)
    );
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

/**
 * Reconcile submitted txs against the subgraph: given the initiating tx hashes
 * (`SubmissionResult.txHash`, stored on each signal_tx), return the on-chain
 * Orders so callers can see whether each was executed, is still pending, or was
 * cancelled (slippage/timeout) - the "actual execution" the DB status can't know.
 */
export async function getOrdersByInitiatedTx(txHashes: readonly string[]): Promise<Order[]> {
  const hashes = txHashes.filter(Boolean) as Hex[];
  if (hashes.length === 0) return [];
  const reader = await getReader();
  return await withRpcRetry(() => reader.getOrders({ initiatedTxHashes: hashes }));
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
