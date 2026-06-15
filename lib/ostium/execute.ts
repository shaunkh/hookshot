/**
 * Turn a validated Signal into Ostium SDK calls and submit them.
 *
 * A Signal may fan out into multiple on-chain txs (largest-Slot-first closes,
 * per-Slot TP/SL, per-order cancels). Each tx is recorded in `signal_txs`; the
 * Signal's final status is filled / failed / partial. A close/modify/cancel that
 * resolves to nothing on-chain is `rejected` (never sent), not failed.
 */
import {
  type CancelOrderParams,
  CancelOrderType,
  type CloseTradeParams,
  type ModifyOrderParams,
  type OpenTradeParams,
  OrderType,
  type OstiumClient,
  type SubmissionResult,
} from "@ostium/builder-sdk";
import { getDelegatedClient } from "./clients.ts";
import { explainContractError } from "./errors.ts";
import { getOpenLimitOrders, getSlots, livePrice } from "./read.ts";
import {
  aggregate,
  allocateAll,
  allocateClose,
  closeTargetBase,
  openCollateral,
  resolveOpenSize,
} from "./pricing.ts";
import { minStr } from "../format.ts";
import { createSignalTx, updateSignalTx } from "../db/repo.ts";
import { withRpcRetry } from "../rpc.ts";
import type { SignalRow, SignalStatus, SignalTxKind, UserRow } from "../types.ts";
import type { ValidateResult } from "../signal/validate.ts";

type ValidatedOk = Extract<ValidateResult, { ok: true }>;

interface Leg {
  kind: SignalTxKind;
  pairId: string;
  idx: number | null;
  paramsJson: string;
  run: (client: OstiumClient) => Promise<SubmissionResult>;
}

type Plan = { ok: true; legs: Leg[] } | { ok: false; reason: string };

function errMessage(e: unknown): string {
  // Decode Ostium contract reverts (e.g. NoTradeFound, WrongLeverage) into a
  // readable message; falls back to the raw error text for everything else.
  return explainContractError(e);
}

async function buildPlan(vr: ValidatedOk, user: UserRow): Promise<Plan> {
  const { cmd, pair, side } = vr;
  const pairId = pair.pairId;
  const trader = user.trader_addr;

  if (cmd.action === "open") {
    const triple = await livePrice(pairId);
    const price = cmd.orderType === "market"
      ? (side === "B" ? triple.ask : triple.bid)
      : cmd.price!;
    const { size, unit } = resolveOpenSize(cmd, user.size_unit);
    const collateral = openCollateral(size, unit, price, vr.leverage);
    const type = cmd.orderType === "limit"
      ? OrderType.Limit
      : cmd.orderType === "stop"
      ? OrderType.Stop
      : OrderType.Market;
    const params: OpenTradeParams = {
      pairId,
      buy: side === "B",
      price,
      collateral,
      leverage: vr.leverage,
      type,
      takeProfit: cmd.takeProfit,
      stopLoss: cmd.stopLoss,
      isDayTrade: vr.isDayTrade,
    };
    return {
      ok: true,
      legs: [{
        kind: "openTrade",
        pairId,
        idx: null,
        paramsJson: JSON.stringify(params),
        run: (c) => c.openTrade(params),
      }],
    };
  }

  if (cmd.action === "close") {
    const slots = await getSlots(trader, pairId, side);
    if (slots.length === 0) {
      return { ok: false, reason: `no open ${cmd.direction} position on ${cmd.symbol}` };
    }
    const price = (await livePrice(pairId)).mid;
    const legs = cmd.size === "all" ? allocateAll(slots) : allocateClose(
      slots,
      minStr(
        closeTargetBase(cmd.size, user.size_unit, price, aggregate(slots)),
        aggregate(slots).base,
      ),
    );
    if (legs.length === 0) return { ok: false, reason: "close size resolves to zero" };
    return {
      ok: true,
      legs: legs.map((l) => {
        const params: CloseTradeParams = {
          pairId,
          idx: l.idx,
          price,
          closePercent: l.closePercent,
        };
        return {
          kind: "closeTrade" as const,
          pairId,
          idx: l.idx,
          paramsJson: JSON.stringify(params),
          run: (c: OstiumClient) => c.closeTrade(params),
        };
      }),
    };
  }

  if (cmd.action === "modify") {
    const slots = await getSlots(trader, pairId, side);
    if (slots.length === 0) {
      return { ok: false, reason: `no open ${cmd.direction} position on ${cmd.symbol}` };
    }
    const legs: Leg[] = [];
    for (const s of slots) {
      // TP and SL must be SEPARATE modifyOrder calls (SDK throws on both w/o price).
      if (cmd.takeProfit !== undefined) {
        const params: ModifyOrderParams = { pairId, idx: s.idx, takeProfit: cmd.takeProfit };
        legs.push({
          kind: "modifyTp",
          pairId,
          idx: s.idx,
          paramsJson: JSON.stringify(params),
          run: (c) => c.modifyOrder(params),
        });
      }
      if (cmd.stopLoss !== undefined) {
        const params: ModifyOrderParams = { pairId, idx: s.idx, stopLoss: cmd.stopLoss };
        legs.push({
          kind: "modifySl",
          pairId,
          idx: s.idx,
          paramsJson: JSON.stringify(params),
          run: (c) => c.modifyOrder(params),
        });
      }
    }
    return { ok: true, legs };
  }

  // cancel
  const orders = await getOpenLimitOrders(trader, pairId, side, cmd.orderType);
  if (orders.length === 0) {
    return {
      ok: false,
      reason: `no open ${cmd.orderType ?? "limit/stop"} orders on ${cmd.symbol}`,
    };
  }
  return {
    ok: true,
    legs: orders.map((o) => {
      const params: CancelOrderParams = { type: CancelOrderType.Limit, pairId, idx: o.idx };
      return {
        kind: "cancelOrder" as const,
        pairId,
        idx: o.idx,
        paramsJson: JSON.stringify(params),
        run: (c: OstiumClient) => c.cancelOrder(params),
      };
    }),
  };
}

export async function runExecution(
  signal: SignalRow,
  vr: ValidatedOk,
  user: UserRow,
): Promise<{ status: SignalStatus; reason?: string }> {
  const plan = await buildPlan(vr, user);
  if (!plan.ok) return { status: "rejected", reason: plan.reason };
  if (plan.legs.length === 0) return { status: "rejected", reason: "nothing to do" };

  const client = await getDelegatedClient(user.trader_addr);
  const rows = plan.legs.map((leg, seq) =>
    createSignalTx({
      signalId: signal.id,
      seq,
      kind: leg.kind,
      pairId: leg.pairId,
      idx: leg.idx,
      paramsJson: leg.paramsJson,
    })
  );

  let submitted = 0;
  let failed = 0;
  for (let i = 0; i < plan.legs.length; i++) {
    try {
      const res = await withRpcRetry(() => plan.legs[i].run(client));
      updateSignalTx(rows[i].id, "submitted", res.txHash, null);
      submitted++;
    } catch (e) {
      updateSignalTx(rows[i].id, "failed", null, errMessage(e));
      failed++;
    }
  }

  // NOTE: "filled" here means "all legs SUBMITTED on-chain", not "confirmed
  // settled". A market order is initiated then filled/cancelled by the oracle, so
  // a submitted tx can still be cancelled (slippage/timeout). Reconciling submitted
  // → settled requires polling getOrders({initiatedTxHashes}) (subgraph lag) and a
  // distinct status; deferred. See README "Known limitations". The txHash is stored
  // on each signal_tx for manual/after-the-fact verification.
  const status: SignalStatus = failed === 0 ? "filled" : submitted === 0 ? "failed" : "partial";
  const reason = status === "partial"
    ? `${submitted}/${plan.legs.length} legs submitted`
    : status === "failed"
    ? "all legs failed"
    : undefined;
  return { status, reason };
}
