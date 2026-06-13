/**
 * Ostium client construction + caching.
 *
 * - One shared read-only client for all resolution reads.
 * - One gasless delegated client per trader (cached) for writes.
 * - One build-only self+self client per trader for delegation-tx calldata.
 * - The Delegate Safe address, derived once at boot from the delegate key.
 *
 * Custody note: the only key here is the shared, trade-only DELEGATE key. No
 * user key is ever loaded. See docs/adr/0001-delegate-key-custody.md.
 */
import { OstiumClient } from "@ostium/builder-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { getConfig } from "../env.ts";

// Caches hold PROMISES; on rejection we evict so a transient failure (e.g. RPC
// hiccup at construction) doesn't permanently brick a trader's webhook.
let _reader: Promise<OstiumClient> | null = null;
export function getReader(): Promise<OstiumClient> {
  return (_reader ??= OstiumClient.createReadOnly({ rpcUrl: getConfig().arbitrumRpcUrl })
    .catch((e) => {
      _reader = null;
      throw e;
    }));
}

const _delegated = new Map<string, Promise<OstiumClient>>();
/** Gasless delegated write client for a trader. Same delegate key + Safe for all. */
export function getDelegatedClient(trader: string): Promise<OstiumClient> {
  const key = trader.toLowerCase();
  let c = _delegated.get(key);
  if (!c) {
    const cfg = getConfig();
    c = OstiumClient.createDelegatedAndGasless({
      delegatePrivateKey: cfg.delegatePrivateKey,
      traderAddress: trader as Address,
      pimlicoUrl: cfg.pimlicoUrl,
    }).catch((e) => {
      _delegated.delete(key);
      throw e;
    });
    _delegated.set(key, c);
  }
  return c;
}

const _build = new Map<string, Promise<OstiumClient>>();
/** Build-only client (no key) used to produce delegation-tx calldata for a trader. */
export function getBuildClient(trader: string): Promise<OstiumClient> {
  const key = trader.toLowerCase();
  let c = _build.get(key);
  if (!c) {
    c = OstiumClient.createSelfAndSelf({
      traderAddress: trader as Address,
      rpcUrl: getConfig().arbitrumRpcUrl,
    }).catch((e) => {
      _build.delete(key);
      throw e;
    });
    _build.set(key, c);
  }
  return c;
}

let _safe: Promise<Address> | null = null;
/**
 * The Delegate's Safe address - what every User must `setDelegate(...)` to.
 * Deterministic from the delegate key, so it's identical for all Users. The
 * constructor needs a `traderAddress`, so we pass the delegate EOA as a
 * placeholder; the returned Safe is a function of the delegate key alone.
 */
export function delegateSafeAddress(): Promise<Address> {
  return (_safe ??= (async () => {
    const cfg = getConfig();
    const delegate = privateKeyToAccount(cfg.delegatePrivateKey).address;
    const client = await OstiumClient.createDelegatedAndGasless({
      delegatePrivateKey: cfg.delegatePrivateKey,
      traderAddress: delegate,
      pimlicoUrl: cfg.pimlicoUrl,
    });
    const safe = client.getSmartAccountAddress();
    if (!safe) throw new Error("could not derive delegate Safe address from delegate key");
    return safe;
  })().catch((e) => {
    _safe = null;
    throw e;
  }));
}
