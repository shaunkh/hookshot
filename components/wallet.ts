/**
 * Browser wallet helpers (used by islands). Lives in components/ so Fresh does
 * NOT treat it as an island; it is bundled into whichever island imports it.
 * All functions assume a browser context (call only from event handlers/effects).
 */
import { type Address, createWalletClient, custom, type EIP1193Provider, type Hex } from "viem";
import { arbitrum } from "viem/chains";

export function provider(): EIP1193Provider | undefined {
  return (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

export function getWallet() {
  const eth = provider();
  if (!eth) throw new Error("No Ethereum wallet found — install MetaMask or similar.");
  return createWalletClient({ chain: arbitrum, transport: custom(eth) });
}

export async function connect(): Promise<Address> {
  const [address] = await getWallet().requestAddresses();
  return address;
}

export async function sendTx(
  account: Address,
  tx: { to: Address; data: Hex; value: string },
): Promise<Hex> {
  return await getWallet().sendTransaction({
    account,
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
  });
}
