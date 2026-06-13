import type { Address } from "viem";
import { define } from "@/utils.ts";
import { delegateSafeAddress, getReader } from "@/lib/ostium/clients.ts";
import { getDelegation, setUsdcApproved, upsertDelegation } from "@/lib/db/repo.ts";
import { cmpStr } from "@/lib/format.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });

    const safe = await delegateSafeAddress();
    const delegation = getDelegation(user.id) ?? upsertDelegation(user.id, safe);

    // Allowance is the live source of truth; the SDK has no delegate getter, so
    // delegate_set stays as recorded from the user's setDelegate receipt.
    let usdcApproved = delegation.usdc_approved === 1;
    try {
      const reader = await getReader();
      const balances = await reader.getBalances(user.trader_addr as Address);
      const live = cmpStr(balances.allowance, "0") > 0;
      if (live !== usdcApproved) setUsdcApproved(user.id, live, null);
      usdcApproved = live;
    } catch {
      // network hiccup - fall back to the cached value
    }

    return ctx.json({
      delegateSafe: safe,
      usdcApproved,
      delegateSet: delegation.delegate_set === 1,
      ready: usdcApproved && delegation.delegate_set === 1,
    });
  },
});
