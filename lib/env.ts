/**
 * Typed, validated environment configuration.
 *
 * Call {@link getConfig} — it memoises and throws a single aggregated error
 * listing everything missing/invalid, so a misconfigured server fails loudly at
 * boot rather than mid-request. Importing this module has no side effects;
 * validation happens on first getConfig() call.
 */
import type { Hex } from "viem";

export interface Config {
  /** Shared Delegate signing key. Trade-only (cannot withdraw). Never a user key. */
  delegatePrivateKey: Hex;
  arbitrumRpcUrl: string;
  /** Pimlico sponsor endpoint for gasless UserOps. */
  pimlicoUrl: string;
  /** HMAC key for signed session cookies. */
  sessionSecret: Uint8Array;
  /** 32-byte AES-GCM key for encrypting webhook secrets at rest. */
  secretEncKey: Uint8Array;
  /** IPs of trusted reverse proxies; only then is X-Forwarded-For honoured. */
  trustedProxyIps: string[];
  cookieSecure: boolean;
  /** e.g. https://trader.example.com — used for SIWE domain + webhook URLs. */
  appOrigin: string;
  dbPath: string;
  port: number;
  readonly chainId: 42161;
}

const DEFAULT_RPC = "https://arb1.arbitrum.io/rpc";
const DEFAULT_PIMLICO = "https://builder.ostium.io/v1/pimlico/sponsor?chainId=42161";
const DEFAULT_ORIGIN = "http://localhost:8000";

/** Decode a key string given as hex (even length) or base64/base64url. */
function decodeKey(raw: string): Uint8Array | null {
  const s = raw.trim();
  if (s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function build(): Config {
  const errs: string[] = [];
  const env = (k: string) => Deno.env.get(k)?.trim() ?? "";

  const dpk = env("DELEGATE_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(dpk)) {
    errs.push("DELEGATE_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string");
  }

  const sessRaw = env("SESSION_SECRET");
  if (sessRaw.length < 32) errs.push("SESSION_SECRET must be at least 32 characters");

  const encRaw = env("SECRET_ENC_KEY");
  const encKey = encRaw ? decodeKey(encRaw) : null;
  if (!encKey || encKey.length !== 32) {
    errs.push("SECRET_ENC_KEY must decode to exactly 32 bytes (64 hex chars or base64)");
  }

  const appOrigin = (env("APP_ORIGIN") || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const cookieSecureRaw = env("COOKIE_SECURE");
  const cookieSecure = cookieSecureRaw
    ? cookieSecureRaw === "true" || cookieSecureRaw === "1"
    : appOrigin.startsWith("https://");

  const portRaw = env("PORT");
  const port = portRaw ? Number(portRaw) : 8000;
  if (!Number.isInteger(port) || port <= 0) errs.push("PORT must be a positive integer");

  if (errs.length) {
    throw new Error(
      "Invalid environment configuration:\n  - " +
        errs.join("\n  - ") +
        "\n\nSee .env.example. Generate 32-byte keys with: openssl rand -hex 32",
    );
  }

  return {
    delegatePrivateKey: dpk as Hex,
    arbitrumRpcUrl: env("ARBITRUM_RPC_URL") || DEFAULT_RPC,
    pimlicoUrl: env("PIMLICO_URL") || DEFAULT_PIMLICO,
    sessionSecret: new TextEncoder().encode(sessRaw),
    secretEncKey: encKey as Uint8Array,
    trustedProxyIps: env("TRUSTED_PROXY_IPS").split(",").map((s) => s.trim()).filter(Boolean),
    cookieSecure,
    appOrigin,
    dbPath: env("DB_PATH") || "./data/app.db",
    port,
    chainId: 42161,
  };
}

let cached: Config | null = null;
export function getConfig(): Config {
  return (cached ??= build());
}
