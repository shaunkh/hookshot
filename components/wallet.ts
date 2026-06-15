/**
 * Browser wallet helpers (used by islands). Lives in components/ so Fresh does
 * NOT treat it as an island; it is bundled into whichever island imports it.
 * All functions assume a browser context (call only from event handlers/effects).
 *
 * Provider selection uses EIP-6963 (Multi Injected Provider Discovery): wallets
 * announce themselves as distinct provider objects, so we never depend on the
 * single, contested `window.ethereum` global. With two wallet extensions
 * installed the loser can't set `window.ethereum` (MetaMask logs "Cannot set
 * property ethereum … which has only a getter"); EIP-6963 sidesteps that entirely
 * and lets the user pick which wallet to use. We fall back to `window.ethereum`
 * only for older wallets that don't announce.
 *
 * The chain is chosen from the server-configured chainId (42161 mainnet /
 * 421614 Arbitrum Sepolia), passed into islands as a prop.
 */
import {
  type Address,
  type Chain,
  createWalletClient,
  custom,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";

/** EIP-6963 wallet metadata announced by each installed wallet. */
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string; // reverse-DNS id, e.g. "io.metamask"
}
interface ProviderDetail {
  info: WalletInfo;
  provider: EIP1193Provider;
}

const STORAGE_KEY = "hookshot:wallet-rdns";
const discovered = new Map<string, ProviderDetail>(); // keyed by rdns
const listeners = new Set<() => void>();
let started = false;

function emitChange() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // a broken listener must not break discovery
    }
  }
}

/** Subscribe to discovery updates (a wallet announced). Returns an unsubscribe fn. */
export function onWallets(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Begin EIP-6963 discovery (idempotent). Wallets announce asynchronously in
 * response to the request event, so callers should also subscribe via onWallets.
 */
export function startWalletDiscovery(): void {
  if (typeof globalThis.addEventListener !== "function") return;
  if (!started) {
    started = true;
    globalThis.addEventListener("eip6963:announceProvider", (e: Event) => {
      const detail = (e as CustomEvent<ProviderDetail>).detail;
      if (detail?.info?.rdns && detail.provider) {
        discovered.set(detail.info.rdns, detail);
        emitChange();
      }
    });
  }
  globalThis.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** All wallets discovered so far (EIP-6963). */
export function listWallets(): WalletInfo[] {
  return [...discovered.values()].map((d) => d.info);
}

export function getSelectedRdns(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setSelectedRdns(rdns: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, rdns);
  } catch {
    // private mode / storage disabled - selection just won't persist
  }
}

function legacyInjected(): EIP1193Provider | undefined {
  return (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

/**
 * The provider to use, in priority order: the user's saved choice, the only
 * discovered wallet, MetaMask if several are present, any discovered wallet,
 * then the legacy `window.ethereum` for wallets that don't support EIP-6963.
 */
export function provider(): EIP1193Provider | undefined {
  const sel = getSelectedRdns();
  if (sel && discovered.has(sel)) return discovered.get(sel)!.provider;
  if (discovered.size === 1) return [...discovered.values()][0].provider;
  const metamask = discovered.get("io.metamask");
  if (metamask) return metamask.provider;
  if (discovered.size > 0) return [...discovered.values()][0].provider;
  return legacyInjected();
}

function chainFor(chainId: number): Chain {
  return chainId === arbitrumSepolia.id ? arbitrumSepolia : arbitrum;
}

export function getWallet(chainId: number, eth: EIP1193Provider | undefined = provider()) {
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
