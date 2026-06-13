import { assertEquals } from "@std/assert";
import { closePercent, cmpStr, divStr, mulDivStr, mulStr, subStr } from "../format.ts";
import {
  aggregate,
  allocateAll,
  allocateClose,
  closeTargetBase,
  openCollateral,
  openNotional,
  type SlotSize,
} from "./pricing.ts";

Deno.test("decimal math has no float drift", () => {
  assertEquals(mulStr("0.1", "0.2", 18), "0.02"); // 0.1*0.2 — float would give 0.020000…4
  assertEquals(mulDivStr("1.5", "65000", "10", 6), "9750"); // size*price/leverage
  assertEquals(divStr("1", "3", 6), "0.333333");
  assertEquals(subStr("1.2", "1.0", 18), "0.2");
  assertEquals(cmpStr("0.5", "1.0"), -1);
});

Deno.test("openCollateral / openNotional per size unit", () => {
  // base: 1.5 BTC @ 65000, 10x → collateral 9750, notional 97500
  assertEquals(openCollateral("1.5", "base", "65000", "10"), "9750");
  assertEquals(openNotional("1.5", "base", "65000", "10"), "97500");
  // usd_collateral: collateral passes through; notional = collateral*leverage
  assertEquals(openCollateral("100", "usd_collateral", "65000", "10"), "100");
  assertEquals(openNotional("100", "usd_collateral", "65000", "10"), "1000");
  // usd_notional: collateral = notional/leverage
  assertEquals(openCollateral("1000", "usd_notional", "65000", "10"), "100");
  assertEquals(openNotional("1000", "usd_notional", "65000", "10"), "1000");
});

Deno.test("largest-slot-first allocation (ADR 0002 worked example)", () => {
  // Position: 1.0 BTC slot (idx 0) + 0.5 BTC slot (idx 1); close 1.2
  const slots: SlotSize[] = [
    { idx: 0, szi: "1.0", collateralUsed: "6500" },
    { idx: 1, szi: "0.5", collateralUsed: "3250" },
  ];
  const legs = allocateClose(slots, "1.2");
  // biggest first: close 1.0 @ 100%, then 0.2 of the 0.5 slot = 40%
  assertEquals(legs, [
    { idx: 0, closePercent: 100 },
    { idx: 1, closePercent: 40 },
  ]);
});

Deno.test("allocation respects ordering regardless of input order", () => {
  const slots: SlotSize[] = [
    { idx: 5, szi: "0.5", collateralUsed: "1" },
    { idx: 9, szi: "1.0", collateralUsed: "1" },
  ];
  // close 1.2 → 1.0 slot (idx 9) fully, then 0.2 of the 0.5 slot (idx 5) = 40%
  assertEquals(allocateClose(slots, "1.2"), [
    { idx: 9, closePercent: 100 },
    { idx: 5, closePercent: 40 },
  ]);
});

Deno.test("closePercent floors to 2dp, caps at 100, dust → 0", () => {
  assertEquals(closePercent("0.5", "0.5"), 100); // exact
  assertEquals(closePercent("0.0001", "1000"), 0); // dust floors to 0 (leg skipped)
  assertEquals(closePercent("2", "1"), 100); // over → cap at 100
  assertEquals(closePercent("1", "3"), 33.33); // floored, not 33.34
});

Deno.test("aggregate sums base + collateral", () => {
  const slots: SlotSize[] = [
    { idx: 0, szi: "1.0", collateralUsed: "6500" },
    { idx: 1, szi: "0.5", collateralUsed: "3250" },
  ];
  assertEquals(aggregate(slots), { base: "1.5", collateral: "9750" });
});

Deno.test("allocateAll closes everything", () => {
  const slots: SlotSize[] = [
    { idx: 0, szi: "1.0", collateralUsed: "1" },
    { idx: 1, szi: "0.5", collateralUsed: "1" },
  ];
  assertEquals(allocateAll(slots), [
    { idx: 0, closePercent: 100 },
    { idx: 1, closePercent: 100 },
  ]);
});

Deno.test("closeTargetBase per unit", () => {
  const agg = { base: "1.5", collateral: "9750" };
  assertEquals(closeTargetBase("1.2", "base", "65000", agg), "1.2");
  // usd_notional: 78000 / 65000 = 1.2
  assertEquals(closeTargetBase("78000", "usd_notional", "65000", agg), "1.2");
  // usd_collateral: 7800 * (1.5/9750) = 1.2
  assertEquals(closeTargetBase("7800", "usd_collateral", "65000", agg), "1.2");
});
