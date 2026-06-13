import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";
import type { Address } from "viem";
import { sendTx } from "../components/wallet.ts";

interface Props {
  traderAddr: string;
}

/** Client-signed delegation onboarding: approve USDC + register the delegate Safe. */
export default function DelegationFlow({ traderAddr }: Props) {
  const safe = useSignal("");
  const usdcApproved = useSignal(false);
  const delegateSet = useSignal(false);
  const ready = useSignal(false);
  const msg = useSignal("");
  const busy = useSignal(false);

  async function refresh() {
    const r = await fetch("/api/delegation/status");
    if (r.ok) {
      const d = await r.json();
      safe.value = d.delegateSafe;
      usdcApproved.value = d.usdcApproved;
      delegateSet.value = d.delegateSet;
      ready.value = d.ready;
    }
  }
  useEffect(() => {
    if (IS_BROWSER) refresh();
  }, []);

  async function runStep(which: "approve" | "setDelegate") {
    busy.value = true;
    msg.value = "";
    try {
      const b = await (await fetch("/api/delegation/build")).json();
      if (b.error) throw new Error(b.error);
      const tx = which === "approve" ? b.approve : b.setDelegate;
      msg.value = "Confirm the transaction in your wallet…";
      const hash = await sendTx(traderAddr as Address, tx);
      await fetch("/api/delegation/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(which === "approve" ? { approveTx: hash } : { setDelegateTx: hash }),
      });
      msg.value = `Submitted: ${hash}`;
      await refresh();
    } catch (e) {
      msg.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="panel">
      <h3>Delegation {ready.value ? "✅ ready" : "— required to trade"}</h3>
      <p class="muted">
        Authorize the trade-only delegate to place trades for you. It can open and close positions
        but <strong>cannot withdraw funds</strong>.
      </p>
      <p class="mono">Delegate Safe: {safe.value || "…"}</p>
      <div class="row">
        <button
          type="button"
          disabled={busy.value || usdcApproved.value}
          onClick={() => runStep("approve")}
        >
          {usdcApproved.value ? "USDC approved ✓" : "1. Approve USDC"}
        </button>
        <button
          type="button"
          disabled={busy.value || delegateSet.value}
          onClick={() => runStep("setDelegate")}
        >
          {delegateSet.value ? "Delegate registered ✓" : "2. Register delegate"}
        </button>
        <button type="button" class="secondary" disabled={busy.value} onClick={refresh}>
          Refresh
        </button>
      </div>
      {msg.value ? <p class="muted">{msg.value}</p> : null}
    </div>
  );
}
