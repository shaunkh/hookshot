/**
 * Decode Ostium contract reverts (custom errors) into human-readable messages.
 *
 * Reverts reach us wrapped in long viem/Pimlico error strings that embed the raw
 * ABI-encoded error blob (selector + args), e.g.
 *   "... reverted ... with reason: 0xefa9e5be...023377".
 * We pull that blob out and decode it against the contract's error ABI
 * (contract-errors.json), turning it into e.g. "NoTradeToTimeoutFound(144247)".
 */
import { type Abi, decodeErrorResult } from "viem";
import errorsAbi from "./contract-errors.json" with { type: "json" };

const ERRORS = errorsAbi as Abi;

/** Decode the first recognizable contract error blob in an error/message. */
export function decodeContractError(err: unknown): string | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  const candidates: string[] = [];
  // Prefer the blob that follows "reason:" - that's the actual revert data.
  const reason = msg.match(/reason:\s*(0x[0-9a-fA-F]+)/);
  if (reason) candidates.push(reason[1]);
  // Fall back to scanning every hex blob long enough to be selector + args.
  for (const m of msg.matchAll(/0x[0-9a-fA-F]{8,}/g)) candidates.push(m[0]);

  for (const data of candidates) {
    try {
      const r = decodeErrorResult({ abi: ERRORS, data: data as `0x${string}` });
      const args = (r.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
      return args.length ? `${r.errorName}(${args.join(", ")})` : r.errorName;
    } catch {
      // not a known error blob - try the next candidate
    }
  }
  return undefined;
}

/** A short, actionable hint for the errors traders are most likely to hit. */
export function hintForError(name: string): string | undefined {
  switch (name) {
    case "NoTradeToTimeoutFound":
      return "the order is no longer pending on-chain (the subgraph is showing a stale/phantom entry) — nothing to cancel";
    case "WaitTimeout":
    case "TooEarly":
      return "the market order hasn't reached its on-chain timeout yet — try again shortly";
    case "NotCloseMarketTimeoutOrder":
    case "NotOpenMarketTimeoutOrder":
      return "this order isn't in a timed-out market state, so it can't be cancelled this way";
    case "NoTradeFound":
    case "NoOpenLimitOrder":
    case "NoLimitFound":
      return "no matching order/trade on-chain (likely already executed or cancelled)";
    case "NotYourOrder":
    case "NotDelegate":
    case "DelegateForbidden":
      return "the delegate isn't authorized to act on this order for this trader";
    default:
      return undefined;
  }
}

/** Best-effort readable explanation of any error - decoded contract error, or the raw message. */
export function explainContractError(err: unknown): string {
  const decoded = decodeContractError(err);
  if (!decoded) return err instanceof Error ? err.message : String(err);
  const name = decoded.split("(")[0];
  const hint = hintForError(name);
  return hint ? `${decoded} — ${hint}` : decoded;
}
