import { define } from "@/utils.ts";
import { listMarkets } from "@/lib/ostium/read.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    try {
      return ctx.json({ markets: await listMarkets() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ctx.json({ error: `failed to load markets: ${message}` }, { status: 502 });
    }
  },
});
