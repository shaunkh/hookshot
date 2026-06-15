/**
 * Decode an Ostium contract revert (custom error) from its hex data.
 *
 *   deno run --allow-read scripts/decode-error.ts 0xefa9e5be...
 *
 * Also prints the 4-byte selector → error-name table so you can map any selector.
 */
import { type Abi, decodeErrorResult, toFunctionSelector } from "viem";
import errorsAbi from "../lib/ostium/contract-errors.json" with { type: "json" };

const abi = errorsAbi as Abi;
const data = (Deno.args[0] ?? "") as `0x${string}`;

if (data) {
  try {
    const r = decodeErrorResult({ abi, data });
    console.log("Decoded error:", r.errorName);
    console.log("Args:", r.args);
  } catch (e) {
    console.log("Could not decode against the ABI:", e instanceof Error ? e.message : e);
  }
}

// Selector table for the orderId-bearing errors (handy for eyeballing).
const selector = data.slice(0, 10);
console.log(`\nSelector in data: ${selector}\n`);
console.log("All error selectors:");
for (const e of abi) {
  if (e.type !== "error") continue;
  const sig = `${e.name}(${(e.inputs ?? []).map((i) => i.type).join(",")})`;
  const sel = toFunctionSelector(sig);
  const mark = sel === selector ? "  <== THIS" : "";
  console.log(`  ${sel}  ${sig}${mark}`);
}
