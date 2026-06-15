import { page } from "fresh";
import { define } from "@/utils.ts";
import { getConfig } from "@/lib/env.ts";
import DelegationFlow from "@/islands/DelegationFlow.tsx";
import OpenTrades from "@/islands/OpenTrades.tsx";
import SignalFeed from "@/islands/SignalFeed.tsx";
import BodyHelper from "@/islands/BodyHelper.tsx";
import PineScript from "@/islands/PineScript.tsx";
import MarketPrices from "@/islands/MarketPrices.tsx";

export const handler = define.handlers({
  GET(ctx) {
    if (!ctx.state.user) return ctx.redirect("/");
    return page();
  },
});

export default define.page(function Dashboard(ctx) {
  const user = ctx.state.user!;
  return (
    <div class="container">
      <div class="row" style="justify-content:space-between">
        <h1>Hookshot</h1>
        <nav class="row">
          <a href="/dashboard/webhooks">Webhooks</a>
          <a href="/dashboard/settings">Settings</a>
          <form method="POST" action="/api/logout">
            <button type="submit" class="secondary">Sign out</button>
          </form>
        </nav>
      </div>
      <p class="muted mono">{user.trader_addr}</p>
      <p class="muted">
        Network: {getConfig().testnet ? "Arbitrum Sepolia (testnet)" : "Arbitrum One"}
      </p>
      <DelegationFlow traderAddr={user.trader_addr} chainId={getConfig().chainId} />
      <OpenTrades testnet={getConfig().testnet} />
      <SignalFeed testnet={getConfig().testnet} />
      <MarketPrices />
      <BodyHelper sizeUnit={user.size_unit} revealSecret={false} />
      <PineScript sizeUnit={user.size_unit} />
    </div>
  );
});
