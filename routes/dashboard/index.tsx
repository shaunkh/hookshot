import { page } from "fresh";
import { define } from "@/utils.ts";
import { getConfig } from "@/lib/env.ts";
import DashboardHeader from "@/components/DashboardHeader.tsx";
import Section from "@/components/Section.tsx";
import SectionOrderControls from "@/islands/SectionOrderControls.tsx";
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
      <DashboardHeader user={user} active="/dashboard" />
      <p class="muted">
        Network: {getConfig().testnet ? "Arbitrum Sepolia (testnet)" : "Arbitrum One"}
      </p>
      <SectionOrderControls />
      <div class="dash-sections" id="dash-sections">
        <Section id="delegation" label="Delegation">
          <DelegationFlow traderAddr={user.trader_addr} chainId={getConfig().chainId} />
        </Section>
        <Section id="trades" label="Open trades">
          <OpenTrades testnet={getConfig().testnet} />
        </Section>
        <Section id="signals" label="Signals & orders">
          <SignalFeed testnet={getConfig().testnet} />
        </Section>
        <Section id="markets" label="Markets & live prices">
          <MarketPrices />
        </Section>
        <Section id="build" label="Build a trade">
          <BodyHelper sizeUnit={user.size_unit} revealSecret={false} />
        </Section>
        <Section id="pine" label="TradingView Pine Script">
          <PineScript sizeUnit={user.size_unit} />
        </Section>
      </div>
    </div>
  );
});
