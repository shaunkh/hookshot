/**
 * Duplicate-Signal suppression. Two layers:
 *  - explicit `clientId` (also enforced by a UNIQUE index as the backstop), and
 *  - byte-identical body to the same webhook within a short window.
 */
import { clientIdExists, hasRecentIdenticalBody } from "../db/repo.ts";

export const DEDUP_WINDOW_MS = 10_000;

export function duplicateReason(
  webhookId: string,
  clientId: string | null,
  bodyHash: string,
): string | null {
  if (clientId && clientIdExists(webhookId, clientId)) return "duplicate clientId";
  if (hasRecentIdenticalBody(webhookId, bodyHash, Date.now() - DEDUP_WINDOW_MS)) {
    return "duplicate body within 10s";
  }
  return null;
}
