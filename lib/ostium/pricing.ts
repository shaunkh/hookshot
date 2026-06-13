/**
 * Size-unit conversions and the largest-Slot-first close allocation (ADR 0002).
 *
 * A Signal's `size` is interpreted per the User's Size Unit; the app converts it
 * into the USD `collateral`/`leverage` Ostium needs for opens, and into a base
 * target + per-Slot `closePercent` for closes.
 */
import type { SizeUnit } from "../types.ts";
import {
  addStr,
  closePercent,
  cmpStr,
  divStr,
  minStr,
  mulDivStr,
  mulStr,
  subStr,
} from "../format.ts";

const USDC_DP = 6; // USDC has 6 decimals
const BASE_DP = 18; // base-asset sizes: keep generous precision

/** A Slot reduced to the fields allocation/aggregation need. */
export interface SlotSize {
  idx: number;
  szi: string; // base-asset size (decimal string)
  collateralUsed: string; // USD (decimal string)
}

export interface CloseLeg {
  idx: number;
  closePercent: number; // 1..100
}

/** Collateral (USD, 6dp) for `openTrade`, derived from Signal size + unit. */
export function openCollateral(
  size: string,
  unit: SizeUnit,
  price: string,
  leverage: string,
): string {
  switch (unit) {
    case "base":
      return mulDivStr(size, price, leverage, USDC_DP); // size * price / leverage
    case "usd_collateral":
      return mulStr(size, "1", USDC_DP); // size is already collateral
    case "usd_notional":
      return divStr(size, leverage, USDC_DP); // notional / leverage
  }
}

/** Position notional (USD) - used for the MIN_OPEN_SIZE_USD bound check. */
export function openNotional(
  size: string,
  unit: SizeUnit,
  price: string,
  leverage: string,
): string {
  switch (unit) {
    case "base":
      return mulStr(size, price, USDC_DP); // size * price
    case "usd_collateral":
      return mulStr(size, leverage, USDC_DP); // collateral * leverage
    case "usd_notional":
      return mulStr(size, "1", USDC_DP); // size is already notional
  }
}

/** Aggregate net base size + total collateral across a pair+direction's Slots. */
export function aggregate(slots: SlotSize[]): { base: string; collateral: string } {
  let base = "0";
  let collateral = "0";
  for (const s of slots) {
    base = addStr(base, s.szi, BASE_DP);
    collateral = addStr(collateral, s.collateralUsed, USDC_DP);
  }
  return { base, collateral };
}

/**
 * Base-asset target size to close, derived from Signal size + unit.
 * For usd_collateral, blends across the aggregate (collateral→base via the
 * Position's own collateral/base ratio).
 */
export function closeTargetBase(
  size: string,
  unit: SizeUnit,
  price: string,
  agg: { base: string; collateral: string },
): string {
  switch (unit) {
    case "base":
      return size;
    case "usd_notional":
      return divStr(size, price, BASE_DP); // notional / price
    case "usd_collateral":
      if (cmpStr(agg.collateral, "0") <= 0) return "0";
      return mulDivStr(size, agg.base, agg.collateral, BASE_DP); // size * base/collateral
  }
}

/**
 * Map a target base size onto Slots, LARGEST SLOT FIRST: fully close the biggest
 * Slots, partially close the next, until the target is met (or Slots run out).
 * Never over-closes (target is clamped to the aggregate by the caller).
 */
export function allocateClose(slots: SlotSize[], targetBase: string): CloseLeg[] {
  const sorted = [...slots].sort((a, b) => cmpStr(b.szi, a.szi));
  const legs: CloseLeg[] = [];
  let remaining = targetBase;
  for (const slot of sorted) {
    if (cmpStr(remaining, "0") <= 0) break;
    if (cmpStr(slot.szi, "0") <= 0) continue;
    const take = minStr(slot.szi, remaining);
    const pct = closePercent(take, slot.szi);
    if (pct > 0) legs.push({ idx: slot.idx, closePercent: pct }); // skip dust (rounds to 0%)
    remaining = subStr(remaining, take, BASE_DP);
  }
  return legs;
}

/** Close the entire Position: 100% of every Slot. */
export function allocateAll(slots: SlotSize[]): CloseLeg[] {
  return slots.map((s) => ({ idx: s.idx, closePercent: 100 }));
}
