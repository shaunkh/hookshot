# Ostium Webhook Trader

Trade [Ostium](https://ostium.com) from any external tool — TradingView alerts,
bots, scripts — by POSTing JSON **Signals** to a webhook URL. A hosted, multi-user
app: sign in with your wallet, delegate trading to a server-held **trade-only**
key, spin up webhooks, and watch signals execute live.

**Your keys never touch the server.** The server holds one shared **Delegate** key
that can open/close trades but **cannot withdraw funds** (Ostium gasless delegated
mode). A breach can grief, not steal. See `docs/adr/0001-delegate-key-custody.md`.

## Stack

- **Deno ≥ 2.8** + **Fresh 2.x** (Vite). SQLite via the built-in `node:sqlite`.
- **viem** (SIWE + delegation), **Valibot** (signal validation), **@ostium/builder-sdk**.
- Glossary: `CONTEXT.md`. Decisions: `docs/adr/`.

## Quick start (local)

```bash
# 1. Tooling (nix users): `nix develop` gives you Deno. Otherwise install Deno >= 2.8.
cp .env.example .env            # then fill DELEGATE_PRIVATE_KEY + generate secrets:
#   SESSION_SECRET:  openssl rand -hex 32
#   SECRET_ENC_KEY:  openssl rand -hex 32
#   DELEGATE_PRIVATE_KEY: a fresh trade-only key (its Safe is what users delegate to)

deno install                    # populate node_modules for Vite
deno task dev                   # http://localhost:5173 (HMR)
```

Production / VPS:

```bash
deno task build                 # -> _fresh/
deno task start                 # deno serve -A _fresh/server.js  (port 8000)
```

The server, on boot, runs DB migrations, starts the in-process execution worker,
and logs the delegate **Safe address** (what users register via `setDelegate`).

## How it works

1. **Sign in** with your wallet (SIWE) — your login address *is* your Ostium trader address.
2. **Delegate** once: from your wallet, approve USDC + `setDelegate(delegateSafe)`.
   Until done, your webhooks can't trade. The server only ever stores your *address*.
3. **Spin up a webhook** — get a URL + secret. Add the source IP(s) of your tool to
   its allowlist (default is **closed to all IPs**), or flip it to allow-all.
4. **POST signals.** Each is authenticated (URL id + body secret + IP), validated,
   acknowledged fast (`202`), then executed asynchronously. Watch status live.

Positions are **aggregated per pair + direction** in base-asset size; a partial
close maps onto the underlying Ostium slots largest-first (`docs/adr/0002`).

## Signal schema

POST JSON to `https://<host>/h/<webhook-id>`. Every body carries `secret`, `symbol`
(e.g. `"BTC/USD"`), `direction` (`"long"`|`"short"`), and an optional `clientId`
(idempotency key). `size` is read in your configured **Size Unit** (base asset by
default; USD-collateral or USD-notional in Settings).

```jsonc
// open
{ "secret":"whsec_…", "action":"open", "symbol":"BTC/USD", "direction":"long",
  "size":"0.05", "leverage":"10", "orderType":"market",   // limit|stop need "price"
  "takeProfit":"75000", "stopLoss":"60000" }              // optional

// close (size or "all")
{ "secret":"whsec_…", "action":"close", "symbol":"BTC/USD", "direction":"long", "size":"all" }

// modify (>=1 of takeProfit/stopLoss) — applied to every matching slot
{ "secret":"whsec_…", "action":"modify", "symbol":"BTC/USD", "direction":"long", "takeProfit":"80000" }

// cancel open limit/stop orders (optional orderType filter)
{ "secret":"whsec_…", "action":"cancel", "symbol":"BTC/USD", "direction":"long" }
```

Unknown fields, bad decimals, unknown pairs, closed markets, sub-$5 notional, or
over-max leverage are **rejected before any on-chain call** (visible in the dashboard).
The dashboard's **Body Helper** generates ready-to-paste JSON + a TradingView
alert-message template for each webhook.

## Verify locally (no real funds)

```bash
deno task build && deno serve -A _fresh/server.js &      # start server
SEED=$(deno run -A scripts/seed.ts)                       # -> {"withIps":"…","noIps":"…","secret":"whsec_test"}
A=$(echo "$SEED" | grep -o '"withIps":"[^"]*"' | cut -d'"' -f4)
B=$(echo "$SEED" | grep -o '"noIps":"[^"]*"'   | cut -d'"' -f4)

curl -s -o/dev/null -w '%{http_code}\n' -X POST localhost:8000/h/nope -d '{}'                 # 404
curl -s -X POST localhost:8000/h/$A -d '{"secret":"WRONG","action":"open","symbol":"BTC/USD","direction":"long","size":"0.01","leverage":"10"}'  # 401
curl -s -X POST localhost:8000/h/$B -d '{"secret":"whsec_test","action":"open","symbol":"BTC/USD","direction":"long","size":"0.01","leverage":"10"}'  # 403 (no IPs = deny)
curl -s -X POST localhost:8000/h/$A -d '{"secret":"whsec_test","action":"open","symbol":"BTC/USD","direction":"long","size":"0.01","leverage":"10","clientId":"x1"}'  # 202

deno run -A scripts/dump-signals.ts                       # inspect signal + tx lifecycle
```

Tests: `deno task test` (decimal/allocation math, validation, IP/CIDR, DB round-trip).

A real on-chain fill needs a funded trader that has delegated to the boot Safe.

## Known limitations

- **`filled` = submitted on-chain, not settled.** A Signal is marked `filled` when
  its txs are broadcast. An Ostium market order is *initiated* then filled/cancelled
  by the oracle, so a submitted tx can still be cancelled (slippage/timeout).
  Reconciling submitted → settled (polling `getOrders` past subgraph lag, plus a
  distinct status) is future work; each leg's `txHash` is stored for verification.
- **Crash mid-execution is fail-safe, not resumed.** A Signal interrupted while
  `executing` may have broadcast some txs; on restart it is marked `failed
  (needs review)` rather than blindly re-submitted (which could double a position).
- **Single global worker.** Execution is serialised across all users; a slow RPC
  affects everyone. Per-(user,pair) fairness is future work.

## Deploying behind a proxy

The per-webhook IP allowlist relies on the source IP. Behind a reverse proxy, set
`TRUSTED_PROXY_IPS` to the proxy's address(es) — only then is `X-Forwarded-For`
honoured (otherwise it's spoofable). Set `APP_ORIGIN` to your https origin so SIWE
domains match and session cookies are `Secure`.
