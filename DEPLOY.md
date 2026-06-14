# Deploying Hookshot to a VPS

This deploys the app on a server with a real domain and automatic HTTPS, using the
same Docker image as local dev. `docker-compose.yml` includes a `caddy` service
(auto-TLS via Let's Encrypt) behind the `proxy` profile, so production traffic
goes `:443 → Caddy → app:8000`.

> Just want to run it on your machine (Docker + a Cloudflare tunnel)? See
> **[LOCAL_DEPLOY.md](LOCAL_DEPLOY.md)**.

---

## Prerequisites

- A **VPS** (any Linux host) with **Docker** + the `docker compose` plugin.
- A **domain** you control.
- DNS **A/AAAA record** for that domain pointing at the VPS public IP. Caddy needs
  this resolvable *before* it can issue a certificate.

---

## 1. Get the code onto the VPS

```bash
git clone <your-repo-url> hookshot && cd hookshot
```

---

## 2. Configure `.env`

```bash
cp .env.example .env
```

Generate the three required secrets:

```bash
echo "DELEGATE_PRIVATE_KEY=0x$(openssl rand -hex 32)"   # trade-only key; never a user key
echo "SESSION_SECRET=$(openssl rand -hex 32)"           # signed-cookie HMAC key
echo "SECRET_ENC_KEY=$(openssl rand -hex 32)"           # AES-256-GCM key for webhook secrets
```

Set the public origin + domain, and the network:

```ini
APP_ORIGIN=https://trader.example.com
APP_DOMAIN=trader.example.com
OSTIUM_TESTNET=false                         # mainnet; also point the RPC at mainnet
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
```

`COOKIE_SECURE` auto-enables for an `https` origin. Use a dedicated
`ARBITRUM_RPC_URL` (Alchemy/Infura) to avoid the public RPC's rate limits.

---

## 3. Open the firewall

```bash
sudo ufw allow 80,443/tcp        # 8000 stays closed — it's bound to loopback
```

---

## 4. Build and run with the proxy profile

```bash
GIT_REVISION=$(git rev-parse HEAD) docker compose --profile proxy up -d --build
```

- `app` serves on `127.0.0.1:8000`; **Caddy** (from the `proxy` profile) reaches it
  over the internal Docker network and terminates TLS on `:443`.
- Caddy obtains + auto-renews a Let's Encrypt certificate for `APP_DOMAIN`.
- `TRUSTED_PROXY_IPS` is pre-set to the compose network subnet, so per-webhook IP
  allowlists see the **real client IP** via `X-Forwarded-For`.
- `restart: unless-stopped` brings both services back after a crash or reboot.

Verify:

```bash
curl https://trader.example.com/api/health        # {"ok":true,...}
```

---

## 5. Lifecycle

```bash
git pull
GIT_REVISION=$(git rev-parse HEAD) docker compose --profile proxy up -d --build   # rolling update
docker compose --profile proxy logs -f                                            # logs
docker compose --profile proxy down                                               # stop (volumes kept)
```

---

## Operations

- **Webhooks / TradingView.** The public webhook URL is
  `https://trader.example.com/h/<webhook-id>` on standard port 443 — exactly what
  TradingView requires. Either keep each webhook's IP allowlist (it sees real IPs
  via Caddy's `X-Forwarded-For`) or flip a webhook to **Allow-all** (still gated by
  URL id + secret).

- **Persistence / backups.** All state is SQLite in the `hookshot-data` volume:

  ```bash
  docker run --rm -v hookshot-data:/d -v "$PWD":/b alpine \
    tar czf /b/hookshot-backup.tgz -C /d .
  ```

- **Funds.** A real on-chain fill needs a **funded trader that has delegated to the
  boot Safe** — independent of hosting. Without it, signals validate but fail at the
  on-chain step (visible per-leg in the Signals feed).

---

## Alternatives to Caddy

- **Existing nginx / Traefik:** drop the `proxy` profile and point your proxy at the
  app. Expose the app to the proxy (e.g. publish `127.0.0.1:8000` as it is, or join
  the proxy to the `hookshot` network), set `TRUSTED_PROXY_IPS` to the proxy's
  address so `X-Forwarded-For` is honored, and forward to `app:8000`.
- **Cloudflare Tunnel (no open ports):** run a named `cloudflared` tunnel on the VPS
  pointing at `http://localhost:8000`; set `APP_ORIGIN` to the tunnel hostname. See
  [LOCAL_DEPLOY.md](LOCAL_DEPLOY.md) for the tunnel mechanics.
