import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";
import {
  getSelectedRdns,
  getWallet,
  listWallets,
  onWallets,
  provider,
  setSelectedRdns,
  startWalletDiscovery,
  type WalletInfo,
} from "../components/wallet.ts";

interface Props {
  /** Configured network chainId (42161 mainnet / 421614 Arbitrum Sepolia). */
  chainId: number;
}

/** Host (incl. port) of a URL, or null if unparseable. */
function hostOf(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

/** Sign-In With Ethereum: connect wallet, sign a server-issued nonce, set session. */
export default function ConnectWallet({ chainId }: Props) {
  const status = useSignal("");
  const error = useSignal("");
  const busy = useSignal(false);
  const wallets = useSignal<WalletInfo[]>([]);
  const selected = useSignal("");

  // EIP-6963 discovery: enumerate installed wallets instead of fighting over the
  // single window.ethereum global (which breaks when two extensions are present).
  useEffect(() => {
    if (!IS_BROWSER) return;
    const sync = () => {
      const found = listWallets();
      wallets.value = found;
      if (!selected.value) {
        const saved = getSelectedRdns();
        selected.value = saved && found.some((w) => w.rdns === saved)
          ? saved
          : (found[0]?.rdns ?? "");
      }
    };
    const off = onWallets(sync);
    startWalletDiscovery();
    sync();
    return off;
  }, []);

  function choose(rdns: string) {
    selected.value = rdns;
    setSelectedRdns(rdns);
  }

  async function connect() {
    if (!IS_BROWSER) return;
    error.value = "";
    if (selected.value) setSelectedRdns(selected.value);
    if (!provider()) {
      status.value = "No Ethereum wallet found - install MetaMask or similar.";
      return;
    }
    busy.value = true;
    try {
      const wallet = getWallet(chainId);
      const [address] = await wallet.requestAddresses();
      status.value = "Requesting sign-in challenge…";
      const nonceRes = await fetch("/api/siwe/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!nonceRes.ok) throw new Error("could not get a sign-in challenge");
      const { message } = await nonceRes.json();

      // The SIWE message's domain comes from the server's APP_ORIGIN. Wallets
      // enforce that it matches the page you're on (anti-phishing) and will
      // reject the signature otherwise - common when serving over `--host` on a
      // LAN IP/port while APP_ORIGIN is still localhost. Catch it here with a
      // clear fix instead of a confusing wallet rejection.
      const uri = /^URI: (.+)$/m.exec(message)?.[1]?.trim();
      const expectedHost = uri ? hostOf(uri) : null;
      if (expectedHost && expectedHost !== globalThis.location.host) {
        status.value = "";
        error.value =
          `Domain mismatch: the server signs for "${expectedHost}" (APP_ORIGIN), but you're ` +
          `visiting "${globalThis.location.host}". Your wallet will reject the signature. ` +
          `Set APP_ORIGIN=${globalThis.location.origin} and restart the server to sign in from here.`;
        return;
      }

      status.value = "Confirm the signature in your wallet…";
      const signature = await wallet.signMessage({ account: address, message });

      status.value = "Verifying…";
      const verifyRes = await fetch("/api/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) throw new Error((await verifyRes.text()) || "verification failed");
      globalThis.location.href = "/dashboard";
    } catch (e) {
      status.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  }

  const multiple = wallets.value.length > 1;

  return (
    <div>
      {multiple
        ? (
          <div class="row" style="margin-bottom:12px">
            <label>
              <span class="muted">Wallet</span>{" "}
              <select
                value={selected.value}
                onChange={(e) => choose((e.target as HTMLSelectElement).value)}
              >
                {wallets.value.map((w) => <option value={w.rdns} key={w.rdns}>{w.name}</option>)}
              </select>
            </label>
          </div>
        )
        : null}
      <button type="button" onClick={connect} disabled={busy.value}>
        {busy.value ? "Working…" : "Connect wallet & sign in"}
      </button>
      {error.value ? <p class="notice-error">{error.value}</p> : null}
      {status.value ? <p class="muted">{status.value}</p> : null}
    </div>
  );
}
