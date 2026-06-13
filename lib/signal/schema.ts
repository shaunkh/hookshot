/**
 * Strict Valibot schemas for webhook Signal bodies (phase-A validation).
 *
 * `v.strictObject` rejects unknown keys; `v.variant("action", …)` discriminates;
 * piped `v.check(...)` enforces cross-field rules. The whole body - including the
 * `secret` - is validated here. See lib/signal/validate.ts for live bounds.
 */
import * as v from "valibot";

// Strictly positive decimal (rejects "0", "0.0", leading-zero junk).
const Decimal = v.pipe(
  v.string(),
  v.regex(/^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/, "must be a positive decimal string"),
);
// Non-negative decimal - used for take-profit/stop-loss where "0" clears the level.
const DecimalOrZero = v.pipe(
  v.string(),
  v.regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string"),
);
const SymbolStr = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9]+\/[A-Za-z0-9]+$/, "must look like BTC/USD"),
);
const Direction = v.picklist(["long", "short"], "must be 'long' or 'short'");

// NOTE: `secret` is intentionally NOT part of this schema. It is an ingest-time
// auth gate (checked in routes/h/[id].ts), then STRIPPED from the stored body so
// it never persists. The worker validates that redacted body, so listing `secret`
// here (with strictObject) would reject every stored signal.
const envelope = {
  symbol: SymbolStr,
  direction: Direction,
  clientId: v.optional(v.string()),
};

export const OpenSchema = v.pipe(
  v.strictObject({
    ...envelope,
    action: v.literal("open"),
    size: Decimal, // base/USD per the user's Size Unit; never "all"
    leverage: v.optional(Decimal),
    orderType: v.optional(v.picklist(["market", "limit", "stop"]), "market"),
    price: v.optional(Decimal),
    takeProfit: v.optional(DecimalOrZero),
    stopLoss: v.optional(DecimalOrZero),
  }),
  v.check(
    (i) => i.orderType === "market" || i.price !== undefined,
    "price is required for limit/stop orders",
  ),
);

export const CloseSchema = v.strictObject({
  ...envelope,
  action: v.literal("close"),
  size: v.union([Decimal, v.literal("all")]), // "all" allowed only on close
});

export const ModifySchema = v.pipe(
  v.strictObject({
    ...envelope,
    action: v.literal("modify"),
    takeProfit: v.optional(DecimalOrZero),
    stopLoss: v.optional(DecimalOrZero),
  }),
  v.check(
    (i) => i.takeProfit !== undefined || i.stopLoss !== undefined,
    "modify requires at least one of takeProfit or stopLoss",
  ),
);

export const CancelSchema = v.strictObject({
  ...envelope,
  action: v.literal("cancel"),
  orderType: v.optional(v.picklist(["limit", "stop"])),
});

export const WebhookSchema = v.variant(
  "action",
  [OpenSchema, CloseSchema, ModifySchema, CancelSchema],
  "unknown or missing action (expected open|close|modify|cancel)",
);

export type WebhookCommand = v.InferOutput<typeof WebhookSchema>;
export type OpenCommand = v.InferOutput<typeof OpenSchema>;
export type CloseCommand = v.InferOutput<typeof CloseSchema>;
export type ModifyCommand = v.InferOutput<typeof ModifySchema>;
export type CancelCommand = v.InferOutput<typeof CancelSchema>;

/** Build a single "field: message; …" string from Valibot issues. */
export function rejection(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues
    .map((i) => {
      const path = v.getDotPath(i);
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join("; ");
}
