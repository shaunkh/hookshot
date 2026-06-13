import { define } from "@/utils.ts";
import { setDefaultLeverage, setSizeUnit } from "@/lib/db/repo.ts";
import { SIZE_UNITS, type SizeUnit } from "@/lib/types.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const body = await ctx.req.json().catch(() => null);

    if (typeof body?.sizeUnit === "string") {
      if (!SIZE_UNITS.includes(body.sizeUnit as SizeUnit)) {
        return ctx.json({ error: "invalid sizeUnit" }, { status: 400 });
      }
      setSizeUnit(user.id, body.sizeUnit as SizeUnit);
    }
    if (body?.defaultLeverage === null || body?.defaultLeverage === "") {
      setDefaultLeverage(user.id, null);
    } else if (typeof body?.defaultLeverage === "string") {
      const lev = body.defaultLeverage;
      // Positive, non-zero, and within a sane ceiling (pair caps enforced at trade time).
      if (!/^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/.test(lev) || Number(lev) > 1000) {
        return ctx.json({ error: "invalid defaultLeverage" }, { status: 400 });
      }
      setDefaultLeverage(user.id, lev);
    }
    return ctx.json({ ok: true });
  },
});
