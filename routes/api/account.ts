import { define } from "@/utils.ts";
import { readAccountSnapshot } from "@/lib/ostium/read.ts";

/**
 * The logged-in trader's live account view: open Positions + margin summary,
 * active limit/stop orders, and pending market orders ("orders in flight").
 * Consumed by the Open Trades and Signals & Orders dashboard panels.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    try {
      return ctx.json(await readAccountSnapshot(user.trader_addr));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ctx.json({ error: `failed to load account: ${message}` }, { status: 502 });
    }
  },
});
