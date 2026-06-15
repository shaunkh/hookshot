/**
 * Manually cancel a single in-flight order on behalf of a trader, via the shared
 * delegated client (same custody model as opens/closes - the delegate can cancel
 * but never withdraw).
 *
 * Two cases:
 *  - Resting limit/stop order: identified by (pairId, idx) from getOpenOrders →
 *    cancelOrder({ type: Limit }).
 *  - Pending market order: the subgraph order id (Order.oid) IS the numeric
 *    on-chain order id, so it's passed straight to the timeout-cancel path
 *    (PendingClose/PendingOpen). Note the contract only allows this once the
 *    market order has timed out.
 */
import { CancelOrderType } from "@ostium/builder-sdk";
import { getDelegatedClient } from "./clients.ts";
import { withRpcRetry } from "../rpc.ts";

export type CancelTarget =
  | { kind: "limit"; pairId: string; idx: number }
  | { kind: "market"; action: string; orderId: string };

export async function cancelInflightOrder(trader: string, t: CancelTarget): Promise<string> {
  const client = await getDelegatedClient(trader);

  if (t.kind === "limit") {
    const res = await withRpcRetry(() =>
      client.cancelOrder({ type: CancelOrderType.Limit, pairId: t.pairId, idx: t.idx })
    );
    return res.txHash;
  }

  const orderId = Number(t.orderId);
  if (!Number.isInteger(orderId) || orderId < 0) {
    throw new Error(`invalid market order id: ${t.orderId}`);
  }
  const res = await withRpcRetry(() =>
    t.action === "Close"
      ? client.cancelOrder({ type: CancelOrderType.PendingClose, orderId, retry: false })
      : client.cancelOrder({ type: CancelOrderType.PendingOpen, orderId })
  );
  return res.txHash;
}
