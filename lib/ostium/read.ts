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
import { cmpStr, divStr, parseSymbol } from "../format.ts";
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

// ── Account snapshot (dashboard) ──────────────────────────────────────────────
//
// A trader's live view: open Positions (with margin summary), active limit/stop
// orders, and pending market orders awaiting the oracle ("orders in flight").
// Each leg is best-effort: if one subgraph query fails the others still return,
// so a partial outage degrades gracefully rather than blanking the panels.

/** One open Position, flattened to display strings (no idx-level Slot detail). */
export interface UiPosition {
  pairId: string;
  symbol: string; // "BTC/USD"
  side: Side; // "B" long / "S" short
  size: string; // base-asset units (magnitude)
  entryPx: string;
  markPx: string; // current mid (= notional / size)
  leverage: string;
  notional: string; // USD
  collateral: string; // USD
  unrealizedPnl: string; // USD, after rollover
  roe: string; // returnOnEquity (fraction)
  liquidationPx: string;
  tpPx: string | null;
  slPx: string | null;
  openTimestamp: number; // unix ms
  idx: number;
}

/** Aggregated margin metrics across all open Positions. */
export interface UiMargin {
  accountValue: string;
  collateral: string;
  notional: string;
  unrealizedPnl: string;
}

/** An active limit/stop order resting on the book ("in flight"). */
export interface UiOpenOrder {
  pairId: string;
  symbol: string;
  side: Side;
  idx: number;
  orderType: string; // "Limit" | "Stop"
  triggerPx: string;
  size: string;
  tpPx: string | null;
  slPx: string | null;
  createdAt: number; // unix ms
}

/**
 * A pending MARKET order submitted on-chain but not yet settled by the oracle.
 * Limit/stop orders are surfaced separately as UiOpenOrder, so this is filtered
 * to `Market` type to avoid double-listing a triggering limit (which can briefly
 * appear in both getOrders({isPending}) and getOpenOrders). A cancelled order is
 * no longer pending, so it never appears here — its outcome shows on the matching
 * webhook-call's on-chain detail instead.
 */
export interface UiPendingOrder {
  orderId: string;
  pairId: string;
  symbol: string;
  side: Side;
  action: string; // "Open" | "Close" | ...
  orderType: string; // always "Market"
  price: string;
  size: string;
  notional: string;
  initiatedAt: number; // unix ms
}

/**
 * Per-leg freshness. `false` means that subgraph query failed on the latest fetch
 * (the data shown is last-known/stale or empty) — the UI must flag this rather
 * than present it as a confident "nothing open".
 */
export interface AccountOk {
  positions: boolean;
  openOrders: boolean;
  pendingOrders: boolean;
}

export interface AccountSnapshot {
  positions: UiPosition[];
  margin: UiMargin;
  openOrders: UiOpenOrder[];
  pendingOrders: UiPendingOrder[];
  ok: AccountOk;
}

const ZERO_MARGIN: UiMargin = {
  accountValue: "0",
  collateral: "0",
  notional: "0",
  unrealizedPnl: "0",
};

const ACCOUNT_TTL_MS = 3_000;
const accountCache = new Map<string, { at: number; snap: AccountSnapshot }>();

interface AccountSlices {
  positions: UiPosition[];
  margin: UiMargin;
  openOrders: UiOpenOrder[];
  pendingOrders: UiPendingOrder[];
}
// Last successful value of each leg, so a transient subgraph failure shows
// last-known (flagged stale via `ok`) data rather than a misleading empty view.
const lastGood = new Map<string, AccountSlices>();

/**
 * The trader's live account view for the dashboard: open Positions + margin
 * summary, active limit/stop orders, and pending market orders. Cached for a
 * few seconds so the two dashboard panels that consume it share one round-trip.
 *
 * Each leg is independent: on failure it reuses the last-known value and sets the
 * matching `ok` flag false, so the UI can show a staleness warning instead of a
 * confident (and dangerous) "nothing open".
 */
export async function readAccountSnapshot(trader: string): Promise<AccountSnapshot> {
  const key = trader.toLowerCase();
  const now = Date.now();
  const cached = accountCache.get(key);
  if (cached && now - cached.at < ACCOUNT_TTL_MS) return cached.snap;

  const reader = await getReader();
  const user = trader as Address;
  const prev = lastGood.get(key);

  let positions = prev?.positions ?? [];
  let margin = prev?.margin ?? ZERO_MARGIN;
  let positionsOk = false;
  try {
    const res = await withRpcRetry(() => reader.getOpenPositions({ user }));
    positions = res.pairPositions.map(({ position: p }) => {
      let markPx = p.entryPx;
      try {
        if (cmpStr(p.szi, "0") > 0) markPx = divStr(p.ntl, p.szi, 8);
      } catch {
        // keep entry price as the fallback mark
      }
      return {
        pairId: p.pairId,
        symbol: `${p.pairFrom}/${p.pairTo}`,
        side: p.side,
        size: p.szi,
        entryPx: p.entryPx,
        markPx,
        leverage: p.leverage,
        notional: p.ntl,
        collateral: p.collateralUsed,
        unrealizedPnl: p.unrealizedPnl,
        roe: p.returnOnEquity,
        liquidationPx: p.liquidationPx,
        tpPx: p.tpPx ?? null,
        slPx: p.slPx ?? null,
        openTimestamp: p.openTimestamp,
        idx: p.idx,
      };
    });
    const m = res.marginSummary;
    margin = {
      accountValue: m.accountValue,
      collateral: m.totalCollateralUsed,
      notional: m.totalNtlPos,
      unrealizedPnl: m.totalRawPnlUsd,
    };
    positionsOk = true;
  } catch {
    // keep prev positions/margin; positionsOk stays false
  }

  let openOrders = prev?.openOrders ?? [];
  let openOrdersOk = false;
  try {
    const orders = await withRpcRetry(() => reader.getOpenOrders({ user }));
    openOrders = orders.map((o) => ({
      pairId: o.pairId,
      symbol: `${o.pairFrom}/${o.pairTo}`,
      side: o.side,
      idx: o.idx,
      orderType: o.orderType,
      triggerPx: o.limitPx,
      size: o.szi,
      tpPx: o.tpPx ?? null,
      slPx: o.slPx ?? null,
      createdAt: o.timestamp,
    }));
    openOrdersOk = true;
  } catch {
    // keep prev openOrders
  }

  let pendingOrders = prev?.pendingOrders ?? [];
  let pendingOrdersOk = false;
  try {
    const orders = await withRpcRetry(() => reader.getOrders({ user, isPending: true }));
    // Market only — limit/stop orders are surfaced as openOrders, and a pending
    // limit would otherwise be listed twice (here and in openOrders).
    pendingOrders = orders
      .filter((o) => o.type === "Market")
      .map((o) => ({
        orderId: o.oid,
        pairId: o.pairId,
        symbol: `${o.pairFrom}/${o.pairTo}`,
        side: o.side,
        action: o.action,
        orderType: o.type,
        price: o.px,
        size: o.szi,
        notional: o.ntl,
        initiatedAt: o.initiatedTime,
      }));
    pendingOrdersOk = true;
  } catch {
    // keep prev pendingOrders
  }

  lastGood.set(key, { positions, margin, openOrders, pendingOrders });
  const snap: AccountSnapshot = {
    positions,
    margin,
    openOrders,
    pendingOrders,
    ok: { positions: positionsOk, openOrders: openOrdersOk, pendingOrders: pendingOrdersOk },
  };
  accountCache.set(key, { at: now, snap });
  return snap;
}
