# Running Hookshot locally (Nix + Docker + Cloudflare tunnel)

This walks through running the whole app **locally in Docker** and exposing it on a
**public HTTPS URL** with `cloudflared`, so external tools (TradingView, bots,
scripts) can reach your webhooks. A public URL is required because those tools
call from their own servers on ports 80/443 — they can't reach `localhost`.

For a permanent server deployment, see **[DEPLOY.md](DEPLOY.md)**.

---

## Prerequisites

**Docker** is required either way — it builds *and* serves the app (the build runs
inside the image, so Deno/SQLite aren't needed on the host). Docker Desktop on
macOS/Windows includes the `docker compose` plugin.

For everything else, pick one:

- **Docker + Nix** — Nix's dev shell provides the rest of the toolchain the steps
  below use (`cloudflared`, `openssl`, `curl`, …). Best if you don't already have
  these. See [Install Nix](#install-nix-optional) below.
- **Docker + the tools yourself** — if **`cloudflared`** (the tunnel) and
  **`openssl`** (to generate secrets) are already on your PATH, **Nix is optional** —
  skip it and run the steps directly on your host.

### Install Nix (optional)

Only needed for the **Docker + Nix** path above. Use the
[Determinate Nix installer](https://docs.determinate.systems/) — it enables flakes by
default and is cleanly uninstallable:

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

Open a **new terminal** afterwards, then enter the dev shell from the repo root:

```bash
nix develop          # drops you into a shell with cloudflared, openssl, curl, …
```

Run the remaining steps from inside this shell. (Docker still runs on the host —
the dev shell provides the toolchain, not the Docker engine.)

---

## 1. Configure `.env`

```bash
cp .env.example .env
```

Generate the three required secrets and paste them in:

```bash
echo "DELEGATE_PRIVATE_KEY=0x$(openssl rand -hex 32)"   # trade-only key; never a user key
echo "SESSION_SECRET=$(openssl rand -hex 32)"           # signed-cookie HMAC key
echo "SECRET_ENC_KEY=$(openssl rand -hex 32)"           # AES-256-GCM key for webhook secrets
```

Pick the network (default is **Arbitrum Sepolia testnet** — recommended while testing):

```ini
OSTIUM_TESTNET=true
# For mainnet: OSTIUM_TESTNET=false  AND  ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
```

Leave `APP_ORIGIN` for now — you'll set it in step 3 once the tunnel gives you a URL.

> A dedicated `ARBITRUM_RPC_URL` (Alchemy/Infura) avoids the public RPC's rate limits.

---

## 2. Start the Cloudflare tunnel

In its own terminal (inside `nix develop` if you're using the Nix path):

```bash
cloudflared tunnel --url http://localhost:8000
```

It prints a public URL like:

```
https://applies-swim-specify-think.trycloudflare.com
```

Copy it. Leave this running — it forwards that URL to `localhost:8000` (where the
container will listen). It's fine that nothing answers yet.

> **Heads-up:** a quick tunnel gives a **new random URL every run**. For a stable
> URL, set up a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
> with your own domain.

---

## 3. Point `.env` at the tunnel URL

Set `APP_ORIGIN` to the URL from step 2:

```ini
APP_ORIGIN=https://applies-swim-specify-think.trycloudflare.com
```

This matters: `APP_ORIGIN` drives the wallet sign-in (SIWE) domain **and** the
webhook URLs shown in the dashboard. `COOKIE_SECURE` auto-enables for an `https`
origin.

---

## 4. Start the app in Docker

```bash
docker compose up --build
```

This builds the image and runs the `app` service on **http://localhost:8000**
(bound to loopback; the tunnel reaches it). On boot it runs DB migrations, starts
the execution worker, and logs the delegate **Safe address**.

Verify it's reachable through the tunnel:

```bash
curl https://<your-tunnel>.trycloudflare.com/api/health     # {"ok":true,...}
```

Useful variants:

```bash
docker compose up -d --build          # run detached
docker compose logs -f app            # tail logs
docker compose down                   # stop (the SQLite volume is kept)
```

---

## 5. Set up your account in the app

Open the **tunnel URL** in your browser (not `localhost` — the SIWE domain must
match `APP_ORIGIN`). Then:

1. **Sign in** with your wallet (SIWE). Your login address *is* your Ostium trader
   address.
2. **Delegate** once: approve USDC + `setDelegate(<delegate Safe>)` from your
   wallet. Until done, webhooks can't trade. The server only stores your *address*.
3. **Create a webhook** on the Webhooks page — you get a URL + secret.
4. **Open its IP gate.** It defaults to deny-all, and behind a tunnel the app sees
   the request from the tunnel, not the caller's real IP — so flip the webhook to
   **Allow-all** (still gated by the URL id + secret). *(Hardening alternative: set
   `TRUSTED_PROXY_IPS` to the Docker gateway and allowlist the caller's real IPs.)*

---

## 6. Send a signal

Use the dashboard's **Build a trade** panel to generate a request body, a
single-URL, or a TradingView alert message.

**Quick test from the terminal** (replace the id/secret with your webhook's):

```bash
curl -i -X POST "https://<your-tunnel>.trycloudflare.com/h/<webhook-id>" \
  -H "content-type: application/json" \
  -d '{"secret":"whsec_…","action":"open","symbol":"BTC/USD","direction":"long","size":"0.01","leverage":"10"}'
# -> 202 {"ok":true,"signalId":"…"}
```

Signals can also be sent entirely as **query params** (single URL, no body) — handy
for TradingView:

```
https://<your-tunnel>.trycloudflare.com/h/<webhook-id>?secret=whsec_…&action=open&symbol=BTC/USD&direction=long&size=0.01&leverage=10
```

**TradingView:** Alert → *Webhook URL* = the single URL above (or the plain
`/h/<id>` URL with the alert message in the body); *Message* = the JSON from the
Build-a-trade panel. Watch execution live in **Signals (live)** on the dashboard.

> A real on-chain fill needs a **funded trader that has delegated to the boot
> Safe**. Without that, signals validate but fail at the on-chain step — visible
> per-leg in the Signals feed.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sign-in fails / cookies don't stick | Browse via the **tunnel URL**, and make sure `APP_ORIGIN` equals it exactly. |
| Webhook returns `403 source IP not allowed` | Flip the webhook to **Allow-all**, or allowlist the caller's IP (+ set `TRUSTED_PROXY_IPS`). |
| Webhook returns `401 invalid secret` | The `secret` in the body/query doesn't match the webhook. Reveal it on the Webhooks page. |
| Tunnel URL changed after restart | Quick tunnels rotate URLs — update `APP_ORIGIN`, restart `docker compose`, re-point your tool. Use a named tunnel for a stable URL. |
| Container can't write the DB | The image forces `DB_PATH=/data/app.db` on the mounted volume — don't override it with a relative path. |
| `nix develop` / `cloudflared` not found | Open a new terminal after installing Nix, then re-run `nix develop` from the repo root. |
