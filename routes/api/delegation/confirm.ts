import { define } from "@/utils.ts";
import { delegateSafeAddress } from "@/lib/ostium/clients.ts";
import {
  getDelegation,
  setDelegateRegistered,
  setUsdcApproved,
  upsertDelegation,
} from "@/lib/db/repo.ts";

/** The client reports submitted setup tx hashes here (the SDK has no delegate getter). */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    if (!getDelegation(user.id)) upsertDelegation(user.id, await delegateSafeAddress());
    const body = await ctx.req.json().catch(() => null);
    if (typeof body?.approveTx === "string") setUsdcApproved(user.id, true, body.approveTx);
    if (typeof body?.setDelegateTx === "string") {
      setDelegateRegistered(user.id, true, body.setDelegateTx);
    }
    return ctx.json({ ok: true });
  },
});
