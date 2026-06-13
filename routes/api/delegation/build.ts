import { define } from "@/utils.ts";
import { delegateSafeAddress, getBuildClient } from "@/lib/ostium/clients.ts";
import { bigintToHex } from "@/lib/format.ts";
import type { BuiltTxRequest } from "@ostium/builder-sdk";

/** A wallet-ready { to, data, value(hex) } the user's own EOA signs + sends. */
function serializeEoaTx(t: BuiltTxRequest) {
  if (t.kind !== "eoa") throw new Error("expected an EOA transaction to self-sign");
  return { to: t.to, data: t.data, value: bigintToHex(t.value) };
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    // Build-only Self+Self client (no key): produces calldata the USER signs.
    const client = await getBuildClient(user.trader_addr);
    const safe = await delegateSafeAddress();
    try {
      return ctx.json({
        delegateSafe: safe,
        approve: serializeEoaTx(client.getApproveUsdcTx("max")),
        setDelegate: serializeEoaTx(client.getSetDelegateTx(safe)),
      });
    } catch (e) {
      return ctx.json(
        { error: e instanceof Error ? e.message : "could not build delegation txs" },
        { status: 500 },
      );
    }
  },
});
