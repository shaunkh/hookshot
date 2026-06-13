import { define } from "@/utils.ts";
import { buildClearCookie } from "@/lib/auth/session.ts";

export const handler = define.handlers({
  POST(ctx) {
    const res = ctx.redirect("/");
    res.headers.append("set-cookie", buildClearCookie());
    return res;
  },
});
