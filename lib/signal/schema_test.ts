import { assert, assertEquals } from "@std/assert";
import * as v from "valibot";
import { rejection, WebhookSchema } from "./schema.ts";

function parse(body: unknown) {
  return v.safeParse(WebhookSchema, body);
}

// `secret` is an ingest gate, not part of the validated (stored/redacted) schema.
const base = { symbol: "BTC/USD", direction: "long" } as const;

Deno.test("valid open injects default orderType=market", () => {
  const r = parse({ ...base, action: "open", size: "1.5", leverage: "10" });
  assert(r.success);
  assertEquals((r.output as { orderType: string }).orderType, "market");
});

Deno.test("open rejects size:'all'", () => {
  const r = parse({ ...base, action: "open", size: "all", leverage: "10" });
  assert(!r.success);
});

Deno.test("strictObject rejects unknown keys", () => {
  const r = parse({ ...base, action: "open", size: "1", leverage: "10", foo: "bar" });
  assert(!r.success);
  assert(rejection(r.issues).includes("foo"));
});

Deno.test("limit/stop open requires price", () => {
  const noPrice = parse({ ...base, action: "open", size: "1", leverage: "10", orderType: "limit" });
  assert(!noPrice.success);
  const withPrice = parse({
    ...base,
    action: "open",
    size: "1",
    leverage: "10",
    orderType: "limit",
    price: "60000",
  });
  assert(withPrice.success);
});

Deno.test("close accepts size:'all' and decimals", () => {
  assert(parse({ ...base, action: "close", size: "all" }).success);
  assert(parse({ ...base, action: "close", size: "0.3" }).success);
});

Deno.test("modify requires at least one of TP/SL", () => {
  assert(!parse({ ...base, action: "modify" }).success);
  assert(parse({ ...base, action: "modify", takeProfit: "70000" }).success);
});

Deno.test("cancel ok with optional orderType filter", () => {
  assert(parse({ ...base, action: "cancel" }).success);
  assert(parse({ ...base, action: "cancel", orderType: "limit" }).success);
  assert(!parse({ ...base, action: "cancel", orderType: "market" }).success);
});

Deno.test("malformed inputs rejected", () => {
  assert(!parse({ ...base, action: "open", size: "1", leverage: "10", symbol: "BTCUSD" }).success);
  assert(!parse({ ...base, action: "frobnicate", size: "1" }).success);
  assert(!parse({ ...base, action: "open", size: "-1", leverage: "10" }).success); // negative
  assert(!parse({ ...base, action: "open", size: "0", leverage: "10" }).success); // zero rejected
  assert(!parse({ ...base, action: "open", size: "1", leverage: "0" }).success); // zero leverage
  assert(!parse({ ...base, action: "open", size: "1", leverage: "10", direction: "up" }).success);
  // a stray `secret` field is now an unknown key (strictObject) and rejected
  assert(!parse({ ...base, action: "close", size: "all", secret: "x" }).success);
});
