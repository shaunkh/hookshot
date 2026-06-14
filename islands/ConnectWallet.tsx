import { useSignal } from "@preact/signals";
import { IS_BROWSER } from "fresh/runtime";
import { getWallet, provider } from "../components/wallet.ts";

interface Props {
  /** Configured network chainId (42161 mainnet / 421614 Arbitrum Sepolia). */
  chainId: number;
}

/** Sign-In With Ethereum: connect wallet, sign a server-issued nonce, set session. */
export default function ConnectWallet({ chainId }: Props) {
  const status = useSignal("");
  const busy = useSignal(false);

  async function connect() {
    if (!IS_BROWSER) return;
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

  return (
    <div>
      <button type="button" onClick={connect} disabled={busy.value}>
        {busy.value ? "Working…" : "Connect wallet & sign in"}
      </button>
      {status.value ? <p class="muted">{status.value}</p> : null}
    </div>
  );
}
