/**
 * Browser wallet helpers (used by islands). Lives in components/ so Fresh does
 * NOT treat it as an island; it is bundled into whichever island imports it.
 * All functions assume a browser context (call only from event handlers/effects).
 *
 * The chain is chosen from the server-configured chainId (42161 mainnet /
 * 421614 Arbitrum Sepolia), passed into islands as a prop.
 */
import { type Address, type Chain, createWalletClient, custom, type EIP1193Provider, type Hex } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";

export function provider(): EIP1193Provider | undefined {
  return (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

function chainFor(chainId: number): Chain {
  return chainId === arbitrumSepolia.id ? arbitrumSepolia : arbitrum;
}

export function getWallet(chainId: number) {
  const eth = provider();
  if (!eth) throw new Error("No Ethereum wallet found - install MetaMask or similar.");
  return createWalletClient({ chain: chainFor(chainId), transport: custom(eth) });
}

export async function connect(chainId: number): Promise<Address> {
  const [address] = await getWallet(chainId).requestAddresses();
  return address;
}

export async function sendTx(
  account: Address,
  tx: { to: Address; data: Hex; value: string },
  chainId: number,
): Promise<Hex> {
  return await getWallet(chainId).sendTransaction({
    account,
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
  });
}
