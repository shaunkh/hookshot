import { OstiumClient } from "@ostium/builder-sdk";
import { withRpcRetry } from "./rpc.ts";

/**
 * Read-only demo: connect to Ostium and print the available pairs and their
 * current prices. Read-only mode needs no private key — only an RPC URL.
 *
 * Every SDK call is wrapped in {@link withRpcRetry} so transient RPC
 * rate-limiting is handled with exponential backoff instead of failing.
 */
export async function main(): Promise<void> {
  const client = await OstiumClient.createReadOnly({
    rpcUrl: Deno.env.get("ARBITRUM_RPC_URL") ?? "https://arb1.arbitrum.io/rpc",
  });

  const log = (attempt: number, delayMs: number) =>
    console.warn(`RPC rate-limited; retry #${attempt} in ${Math.round(delayMs)}ms`);

  const { pairs } = await withRpcRetry(() => client.getPairs(), {
    onRetry: ({ attempt, delayMs }) => log(attempt, delayMs),
  });
  const { prices } = await withRpcRetry(() => client.getAllPrices(), {
    onRetry: ({ attempt, delayMs }) => log(attempt, delayMs),
  });

  console.log(`Found ${pairs.length} pairs`);
  for (const pair of pairs.slice(0, 10)) {
    const price = prices[pair.pairId];
    console.log(`${pair.pairFrom}/${pair.pairTo}`, price ?? "(no price)");
  }
}

if (import.meta.main) {
  await main();
}
