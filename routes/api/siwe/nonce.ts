import { define } from "@/utils.ts";
import { createNonce } from "@/lib/db/repo.ts";
import { buildSiweMessage } from "@/lib/auth/siwe.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null);
    const address = body?.address;
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return ctx.json({ error: "invalid address" }, { status: 400 });
    }
    const nonce = createNonce(address);
    const message = buildSiweMessage(address, nonce, new Date().toISOString());
    return ctx.json({ message });
  },
});
