/**
 * Two-phase Signal validation:
 *   A. Static — strict schema parse (Valibot), no network.
 *   B. Live bounds — pair exists, market open, leverage ≤ pair max, notional ≥
 *      MIN_OPEN_SIZE_USD, and auto day-trade when leverage exceeds the overnight
 *      cap. A rejected Signal is NEVER sent on-chain.
 */
import * as v from "valibot";
import { MIN_COLLATERAL_USD, MIN_OPEN_SIZE_USD } from "@ostium/builder-sdk";
import type { Pair } from "@ostium/builder-sdk";
import { rejection, type WebhookCommand, WebhookSchema } from "./schema.ts";
import { livePrice, resolvePair } from "../ostium/read.ts";
import { openCollateral, openNotional } from "../ostium/pricing.ts";
import { cmpStr } from "../format.ts";
import { directionToSide, type Side, type SizeUnit } from "../types.ts";

const MIN_OPEN_USD = String(MIN_OPEN_SIZE_USD);
const MIN_COLLATERAL = String(MIN_COLLATERAL_USD);

export type ValidateResult =
  | {
    ok: true;
    cmd: WebhookCommand;
    pair: Pair;
    side: Side;
    /** Resolved leverage for opens ("0" for other actions). */
    leverage: string;
    isDayTrade: boolean;
  }
  | { ok: false; reason: string };

export interface ValidateOpts {
  sizeUnit: SizeUnit;
  defaultLeverage: string | null;
}

export async function validateSignal(rawBody: string, opts: ValidateOpts): Promise<ValidateResult> {
  // ── Phase A: parse + strict schema ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid JSON body" };
  }
  const r = v.safeParse(WebhookSchema, parsed);
  if (!r.success) return { ok: false, reason: rejection(r.issues) };
  const cmd = r.output;

  // ── Phase B: live bounds ──
  const pair = await resolvePair(cmd.symbol);
  if (!pair) return { ok: false, reason: `unknown pair ${cmd.symbol}` };
  if (!pair.isMarketOpen) return { ok: false, reason: `market closed for ${cmd.symbol}` };

  const side = directionToSide(cmd.direction);
  let leverage = "0";
  let isDayTrade = false;

  if (cmd.action === "open") {
    leverage = cmd.leverage ?? opts.defaultLeverage ?? "";
    if (!leverage) {
      return { ok: false, reason: "leverage is required (no per-user default set)" };
    }
    if (cmpStr(leverage, String(pair.maxLeverage)) > 0) {
      return { ok: false, reason: `leverage ${leverage} exceeds pair max ${pair.maxLeverage}` };
    }
    const price = cmd.orderType === "market" ? (await livePrice(pair.pairId)).mid : cmd.price!;
    const notional = openNotional(cmd.size, opts.sizeUnit, price, leverage);
    if (cmpStr(notional, MIN_OPEN_USD) < 0) {
      return { ok: false, reason: `notional ${notional} below $${MIN_OPEN_USD} minimum` };
    }
    // The contract enforces collateral >= MIN_COLLATERAL_USD, so a high-leverage
    // open can clear the notional check yet revert on submit — reject early.
    const collateral = openCollateral(cmd.size, opts.sizeUnit, price, leverage);
    if (cmpStr(collateral, MIN_COLLATERAL) < 0) {
      return { ok: false, reason: `collateral ${collateral} below $${MIN_COLLATERAL} minimum` };
    }
    if (pair.overnightMaxLeverage > 0 && cmpStr(leverage, String(pair.overnightMaxLeverage)) > 0) {
      isDayTrade = true; // required when exceeding the overnight cap
    }
  }

  return { ok: true, cmd, pair, side, leverage, isDayTrade };
}
