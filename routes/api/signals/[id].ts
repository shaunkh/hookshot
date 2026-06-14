import { define } from "@/utils.ts";
import { getSignal, listSignalTxs } from "@/lib/db/repo.ts";
import { getOrdersByInitiatedTx } from "@/lib/ostium/read.ts";

/** Subgraph execution state for a submitted leg, keyed by its initiating tx hash. */
interface OnChain {
  orderId: string;
  status: "pending" | "executed" | "cancelled";
  cancelReason: string | null;
  price: string;
  closedPnl: string;
  executedTx: string;
  executedAt: number;
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const s = getSignal(ctx.params.id);
    if (!s || s.user_id !== user.id) return ctx.json({ error: "not found" }, { status: 404 });
    const rows = listSignalTxs(s.id);

    // Reconcile submitted legs against the subgraph (best-effort: if it's
    // unreachable or lagging we still return the DB view, just without onchain).
    const byTx = new Map<string, OnChain>();
    const hashes = rows.map((t) => t.tx_hash).filter((h): h is string => !!h);
    if (hashes.length > 0) {
      try {
        for (const o of await getOrdersByInitiatedTx(hashes)) {
          if (!o.initiatedTx) continue;
          byTx.set(o.initiatedTx.toLowerCase(), {
            orderId: o.oid,
            status: o.isCancelled ? "cancelled" : o.isPending ? "pending" : "executed",
            cancelReason: o.cancelReason ?? null,
            price: o.px,
            closedPnl: o.closedPnl,
            executedTx: o.hash,
            executedAt: o.time,
          });
        }
      } catch (_e) {
        // leave byTx empty - the UI falls back to the submitted/failed DB status
      }
    }

    const txs = rows.map((t) => ({
      seq: t.seq,
      kind: t.kind,
      pairId: t.pair_id,
      idx: t.idx,
      status: t.status,
      txHash: t.tx_hash,
      error: t.error,
      params: JSON.parse(t.params_json),
      onchain: t.tx_hash ? byTx.get(t.tx_hash.toLowerCase()) ?? null : null,
    }));
    return ctx.json({
      signal: {
        id: s.id,
        action: s.action,
        symbol: s.symbol,
        side: s.side,
        status: s.status,
        reason: s.reason,
        rawBody: s.raw_body,
        sourceIp: s.source_ip,
        receivedAt: s.received_at,
        executedAt: s.executed_at,
      },
      txs,
    });
  },
});
