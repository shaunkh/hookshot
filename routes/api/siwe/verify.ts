import type { Hex } from "viem";
import { define } from "@/utils.ts";
import { consumeNonce, upsertUser } from "@/lib/db/repo.ts";
import { fieldsValid, parseSiweMessage, recoverSigner } from "@/lib/auth/siwe.ts";
import { buildSetCookie, SESSION_TTL_MS, signSession } from "@/lib/auth/session.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null);
    const message = body?.message;
    const signature = body?.signature;
    if (typeof message !== "string" || typeof signature !== "string") {
      return ctx.json({ error: "missing message/signature" }, { status: 400 });
    }
    const parsed = parseSiweMessage(message);
    if (!parsed || !fieldsValid(parsed)) {
      return ctx.json({ error: "invalid SIWE message" }, { status: 400 });
    }
    // Single-use nonce check (consumes it, bound to the claimed address).
    if (!consumeNonce(parsed.nonce, parsed.address)) {
      return ctx.json({ error: "invalid or expired nonce" }, { status: 401 });
    }
    const recovered = await recoverSigner(message, signature as Hex);
    if (!recovered || recovered.toLowerCase() !== parsed.address.toLowerCase()) {
      return ctx.json({ error: "signature does not match address" }, { status: 401 });
    }

    const user = upsertUser(recovered);
    const token = await signSession({ userId: user.id, exp: Date.now() + SESSION_TTL_MS });
    const res = ctx.json({ ok: true, address: user.trader_addr });
    res.headers.append("set-cookie", buildSetCookie(token));
    return res;
  },
});
