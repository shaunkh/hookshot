import { define } from "@/utils.ts";
import { cancelInflightOrder, type CancelTarget } from "@/lib/ostium/cancel.ts";
import { explainContractError } from "@/lib/ostium/errors.ts";

/** Validate the request body into a CancelTarget (or null if malformed). */
function parseTarget(b: unknown): CancelTarget | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (o.kind === "limit") {
    if (typeof o.pairId !== "string" || typeof o.idx !== "number" || !Number.isInteger(o.idx)) {
      return null;
    }
    return { kind: "limit", pairId: o.pairId, idx: o.idx };
  }
  if (o.kind === "market") {
    if (typeof o.action !== "string") return null;
    if (typeof o.orderId !== "string" || !/^\d+$/.test(o.orderId)) return null;
    return { kind: "market", action: o.action, orderId: o.orderId };
  }
  return null;
}

/**
 * Cancel one in-flight order for the logged-in trader. The delegated client is
 * scoped to the trader, so a User can only ever cancel their own orders.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const target = parseTarget(await ctx.req.json().catch(() => null));
    if (!target) return ctx.json({ error: "invalid cancel request" }, { status: 400 });
    try {
      const txHash = await cancelInflightOrder(user.trader_addr, target);
      return ctx.json({ ok: true, txHash });
    } catch (e) {
      return ctx.json({ error: `cancel failed: ${explainContractError(e)}` }, { status: 502 });
    }
  },
});
