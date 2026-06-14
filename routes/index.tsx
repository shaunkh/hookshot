import { define } from "../utils.ts";
import { getConfig } from "@/lib/env.ts";
import ConnectWallet from "../islands/ConnectWallet.tsx";

export default define.page(function Home(ctx) {
  const user = ctx.state.user;
  return (
    <div class="container">
      <h1>Hookshot</h1>
      <p class="muted" style="font-size:18px;margin-top:-8px">Catch every move.</p>
      <p class="muted">
        Trade Ostium from any external tool (TradingView, bots, scripts) by POSTing JSON signals to
        a webhook URL. Your keys never touch the server - trades execute via a trade-only delegate
        that cannot withdraw funds.
      </p>
      {user
        ? (
          <p>
            Signed in as <code>{user.trader_addr}</code> -{" "}
            <a href="/dashboard">Go to your dashboard →</a>
          </p>
        )
        : (
          <div class="panel">
            <h3>Sign in</h3>
            <p class="muted">Connect your wallet to create webhooks and manage delegation.</p>
            <ConnectWallet chainId={getConfig().chainId} />
          </div>
        )}
    </div>
  );
});
