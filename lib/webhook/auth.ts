/**
 * The two cryptographic/network webhook gates (the third - that the webhook id
 * exists and is active - is a DB lookup done in the route). Kept pure so the
 * route composes 404/401/403 around them.
 */
import { decryptSecret, secretsMatch } from "../crypto.ts";
import { ipAllowed } from "./ip.ts";
import type { WebhookIpRow, WebhookRow } from "../types.ts";

/** Constant-time check of a provided secret against the webhook's stored one. */
export async function secretOk(webhook: WebhookRow, provided: string): Promise<boolean> {
  const actual = await decryptSecret(webhook.secret_enc);
  return secretsMatch(provided, actual);
}

/**
 * Is `sourceIp` allowed for this webhook? `allow_all` accepts any; otherwise the
 * IP must match an allowlist entry. An empty allowlist denies all (fail closed).
 */
export function ipOk(webhook: WebhookRow, ips: WebhookIpRow[], sourceIp: string): boolean {
  if (webhook.allow_mode === "allow_all") return true;
  if (ips.length === 0) return false; // default: closed to all IPs
  return ipAllowed(sourceIp, ips.map((i) => i.cidr));
}
