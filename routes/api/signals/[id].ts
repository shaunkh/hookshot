import { define } from "@/utils.ts";
import { getSignal, listSignalTxs } from "@/lib/db/repo.ts";

export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const s = getSignal(ctx.params.id);
    if (!s || s.user_id !== user.id) return ctx.json({ error: "not found" }, { status: 404 });
    const txs = listSignalTxs(s.id).map((t) => ({
      seq: t.seq,
      kind: t.kind,
      pairId: t.pair_id,
      idx: t.idx,
      status: t.status,
      txHash: t.tx_hash,
      error: t.error,
      params: JSON.parse(t.params_json),
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
