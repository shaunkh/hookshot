import { define } from "@/utils.ts";
import { listSignals } from "@/lib/db/repo.ts";

export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const limit = Math.min(Number(ctx.url.searchParams.get("limit")) || 100, 500);
    const signals = listSignals(user.id, limit).map((s) => ({
      id: s.id,
      webhookId: s.webhook_id,
      action: s.action,
      symbol: s.symbol,
      side: s.side,
      status: s.status,
      reason: s.reason,
      clientId: s.client_id,
      sourceIp: s.source_ip,
      receivedAt: s.received_at,
      executedAt: s.executed_at,
    }));
    return ctx.json({ signals });
  },
});
