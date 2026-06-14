import { Fragment } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

interface Sig {
  id: string;
  action: string | null;
  symbol: string | null;
  side: string | null;
  status: string;
  reason: string | null;
  sourceIp: string;
  receivedAt: number;
}

interface OnChain {
  orderId: string;
  status: "pending" | "executed" | "cancelled";
  cancelReason: string | null;
  price: string;
  closedPnl: string;
  executedTx: string;
  executedAt: number;
}
interface Tx {
  seq: number;
  kind: string;
  idx: number | null;
  status: string;
  txHash: string | null;
  error: string | null;
  onchain: OnChain | null;
}

function short(h: string): string {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

interface Props {
  /** Whether the app is on Arbitrum Sepolia (picks the explorer host). */
  testnet?: boolean;
}

export default function SignalFeed({ testnet = true }: Props) {
  const explorer = testnet ? "https://sepolia.arbiscan.io" : "https://arbiscan.io";
  const TxLink = ({ hash, label }: { hash: string; label?: string }) => (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      {label ?? short(hash)}
    </a>
  );
  const signals = useSignal<Sig[]>([]);
  const expanded = useSignal<string>("");
  const details = useSignal<Record<string, Tx[]>>({});

  async function load() {
    const r = await fetch("/api/signals?limit=100");
    if (r.ok) signals.value = (await r.json()).signals;
  }

  async function loadDetail(id: string) {
    const r = await fetch(`/api/signals/${id}`);
    if (r.ok) details.value = { ...details.value, [id]: (await r.json()).txs };
  }

  async function toggle(id: string) {
    if (expanded.value === id) {
      expanded.value = "";
      return;
    }
    expanded.value = id;
    await loadDetail(id); // always re-pull so on-chain state is fresh
  }

  useEffect(() => {
    if (!IS_BROWSER) return;
    load();
    const es = new EventSource("/api/events");
    es.onmessage = () => {
      load();
      if (expanded.value) loadDetail(expanded.value); // refresh open detail too
    };
    es.onerror = () => {/* browser auto-reconnects */};
    return () => es.close();
  }, []);

  async function refresh() {
    await load();
    if (expanded.value) await loadDetail(expanded.value);
  }

  return (
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h3>Signals (live)</h3>
        <button type="button" class="secondary" onClick={refresh}>Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>action</th>
            <th>pair</th>
            <th>dir</th>
            <th>status</th>
            <th>detail</th>
            <th>from IP</th>
          </tr>
        </thead>
        <tbody>
          {signals.value.map((s) => {
            const isOpen = expanded.value === s.id;
            const txs = details.value[s.id];
            return (
              <Fragment key={s.id}>
                <tr onClick={() => toggle(s.id)} style="cursor:pointer">
                  <td class="mono">
                    {isOpen ? "▾ " : "▸ "}
                    {new Date(s.receivedAt).toLocaleTimeString()}
                  </td>
                  <td>{s.action ?? "-"}</td>
                  <td>{s.symbol ?? "-"}</td>
                  <td>{s.side === "B" ? "long" : s.side === "S" ? "short" : "-"}</td>
                  <td>
                    <span class={`badge ${s.status}`}>{s.status}</span>
                  </td>
                  <td class="muted">{s.reason ?? ""}</td>
                  <td class="mono muted">{s.sourceIp}</td>
                </tr>
                {isOpen
                  ? (
                    <tr>
                      <td colSpan={7} style="background:var(--input-bkg)">
                        {txs === undefined
                          ? <span class="muted">loading on-chain execution…</span>
                          : txs.length === 0
                          ? (
                            <span class="muted">
                              No on-chain txs (signal was {s.status} before submission).
                            </span>
                          )
                          : (
                            <table>
                              <thead>
                                <tr>
                                  <th>leg</th>
                                  <th>submission</th>
                                  <th>on-chain</th>
                                  <th>order id</th>
                                  <th>fill px</th>
                                  <th>pnl</th>
                                  <th>tx</th>
                                </tr>
                              </thead>
                              <tbody>
                                {txs.map((t) => {
                                  const oc = t.onchain;
                                  const ocBadge = oc
                                    ? oc.status === "executed"
                                      ? "filled"
                                      : oc.status === "cancelled"
                                      ? "failed"
                                      : "executing"
                                    : "";
                                  return (
                                    <tr key={t.seq}>
                                      <td>
                                        {t.kind}
                                        {t.idx !== null ? ` #${t.idx}` : ""}
                                      </td>
                                      <td>
                                        <span class={`badge ${t.status}`}>{t.status}</span>
                                        {t.error
                                          ? <div class="muted">{t.error}</div>
                                          : null}
                                      </td>
                                      <td>
                                        {oc
                                          ? (
                                            <>
                                              <span class={`badge ${ocBadge}`}>{oc.status}</span>
                                              {oc.cancelReason
                                                ? <div class="muted">{oc.cancelReason}</div>
                                                : null}
                                            </>
                                          )
                                          : t.txHash
                                          ? <span class="muted">awaiting oracle…</span>
                                          : <span class="muted">-</span>}
                                      </td>
                                      <td class="mono">{oc?.orderId ?? "-"}</td>
                                      <td class="mono">{oc && oc.status === "executed" ? oc.price : "-"}</td>
                                      <td class="mono">
                                        {oc && oc.status === "executed" && oc.closedPnl !== "0"
                                          ? oc.closedPnl
                                          : "-"}
                                      </td>
                                      <td class="mono">
                                        {t.txHash ? <TxLink hash={t.txHash} /> : "-"}
                                        {oc && oc.executedTx && oc.executedTx !== t.txHash
                                          ? (
                                            <>
                                              {" "}
                                              <TxLink hash={oc.executedTx} label="(exec)" />
                                            </>
                                          )
                                          : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                      </td>
                    </tr>
                  )
                  : null}
              </Fragment>
            );
          })}
          {signals.value.length === 0
            ? (
              <tr>
                <td colSpan={7} class="muted">No signals yet - POST one to a webhook.</td>
              </tr>
            )
            : null}
        </tbody>
      </table>
      <p class="muted">Click a row to see its on-chain execution.</p>
    </div>
  );
}
