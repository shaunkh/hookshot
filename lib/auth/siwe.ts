/**
 * Sign-In With Ethereum (EIP-4361) — server side, verified with viem alone (no
 * separate `siwe` package). The server builds the canonical message (so it owns
 * the nonce + fields); the client signs it; we recover the signer and re-check
 * the fields. Nonce consumption is done by the route via repo.consumeNonce.
 */
import { recoverMessageAddress } from "viem";
import type { Address, Hex } from "viem";
import { getConfig } from "../env.ts";

const STATEMENT = "Sign in to Ostium Webhook Trader.";

export function buildSiweMessage(address: string, nonce: string, issuedAt: string): string {
  const cfg = getConfig();
  const domain = new URL(cfg.appOrigin).host;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    STATEMENT,
    "",
    `URI: ${cfg.appOrigin}`,
    "Version: 1",
    `Chain ID: ${cfg.chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export interface ParsedSiwe {
  address: string;
  domain: string;
  uri: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
}

function field(msg: string, label: string): string | null {
  const m = new RegExp(`^${label}: (.+)$`, "m").exec(msg);
  return m ? m[1].trim() : null;
}

export function parseSiweMessage(msg: string): ParsedSiwe | null {
  const lines = msg.split("\n");
  const domainMatch = /^(.+) wants you to sign in with your Ethereum account:$/.exec(
    lines[0] ?? "",
  );
  const address = (lines[1] ?? "").trim();
  const uri = field(msg, "URI");
  const chainId = field(msg, "Chain ID");
  const nonce = field(msg, "Nonce");
  const issuedAt = field(msg, "Issued At");
  if (
    !domainMatch || !/^0x[0-9a-fA-F]{40}$/.test(address) || !uri || !chainId || !nonce || !issuedAt
  ) {
    return null;
  }
  return { address, domain: domainMatch[1], uri, chainId, nonce, issuedAt };
}

/** Confirm the message's domain/uri/chainId match this server's config. */
export function fieldsValid(p: ParsedSiwe): boolean {
  const cfg = getConfig();
  return (
    p.domain === new URL(cfg.appOrigin).host &&
    p.uri === cfg.appOrigin &&
    p.chainId === String(cfg.chainId)
  );
}

export async function recoverSigner(message: string, signature: Hex): Promise<Address | null> {
  try {
    return await recoverMessageAddress({ message, signature });
  } catch {
    return null;
  }
}
