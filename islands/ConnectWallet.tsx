import { useSignal } from "@preact/signals";
import { IS_BROWSER } from "fresh/runtime";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { arbitrum } from "viem/chains";

function provider(): EIP1193Provider | undefined {
  return (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

/** Sign-In With Ethereum: connect wallet, sign a server-issued nonce, set session. */
export default function ConnectWallet() {
  const status = useSignal("");
  const busy = useSignal(false);

  async function connect() {
    if (!IS_BROWSER) return;
    const eth = provider();
    if (!eth) {
      status.value = "No Ethereum wallet found — install MetaMask or similar.";
      return;
    }
    busy.value = true;
    try {
      const wallet = createWalletClient({ chain: arbitrum, transport: custom(eth) });
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
