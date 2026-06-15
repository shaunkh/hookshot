import { Fragment } from "preact";
import { useComputed, useSignal } from "@preact/signals";
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

/** An order still working on-chain: a pending market order or a resting limit/stop. */
interface InflightOrder {
  key: string;
  kind: "market" | "limit";
  symbol: string;
  side: "B" | "S";
  type: string; // "Open"/"Close" (market) or "Limit"/"Stop"
  price: string; // trigger (limit/stop) or requested px (market)
  size: string;
  at: number; // unix ms
  // Cancel identity: (pairId, idx) for limit/stop; orderId for market.
  pairId: string;
  idx: number | null;
  orderId: string | null;
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

/** Price with precision adapted to magnitude (BTC vs EUR/USD). */
function px(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const a = Math.abs(n);
  const dp = a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Base-asset size, trimmed to ≤4 dp. */
function sz(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// Shapes returned by /api/account for the orders-in-flight view.
interface ApiOpenOrder {
  pairId: string;
  symbol: string;
  side: "B" | "S";
  idx: number;
  orderType: string;
  triggerPx: string;
  size: string;
  createdAt: number;
}
interface ApiPendingOrder {
  orderId: string;
  pairId: string;
  symbol: string;
  side: "B" | "S";
  action: string;
  orderType: string;
  price: string;
  size: string;
  initiatedAt: number;
}
interface ApiAccountOk {
  positions: boolean;
  openOrders: boolean;
  pendingOrders: boolean;
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
  const inflight = useSignal<InflightOrder[]>([]);
  // True when an orders leg failed on the last fetch (list may be stale).
  const inflightStale = useSignal(false);
  // Keys currently being cancelled, and the last cancel result/error message.
  const cancelling = useSignal<Record<string, boolean>>({});
  const cancelMsg = useSignal("");

  async function load() {
    const r = await fetch("/api/signals?limit=100");
    if (r.ok) signals.value = (await r.json()).signals;
  }

  async function loadInflight() {
    try {
      const r = await fetch("/api/account");
      if (!r.ok) return;
      const a = await r.json() as {
        openOrders?: ApiOpenOrder[];
        pendingOrders?: ApiPendingOrder[];
        ok?: ApiAccountOk;
      };
      const market: InflightOrder[] = (a.pendingOrders ?? []).map((o) => ({
        key: `m-${o.orderId}`,
        kind: "market",
        symbol: o.symbol,
        side: o.side,
        type: o.action, // Open / Close
        price: o.price,
        size: o.size,
        at: o.initiatedAt,
        pairId: o.pairId,
        idx: null,
        orderId: o.orderId,
      }));
      const limits: InflightOrder[] = (a.openOrders ?? []).map((o) => ({
        key: `l-${o.pairId}-${o.idx}`,
        kind: "limit",
        symbol: o.symbol,
        side: o.side,
        type: o.orderType, // Limit / Stop
        price: o.triggerPx,
        size: o.size,
        at: o.createdAt,
        pairId: o.pairId,
        idx: o.idx,
        orderId: null,
      }));
      inflight.value = [...market, ...limits].sort((x, y) => y.at - x.at);
      inflightStale.value = a.ok ? !a.ok.openOrders || !a.ok.pendingOrders : false;
    } catch {
      // best-effort: leave the last view in place
    }
  }

  /** The (pairId, idx) or initiatedTx needed to cancel; null if not cancellable here. */
  function cancelTarget(o: InflightOrder) {
    if (o.kind === "limit" && o.idx !== null) {
      return { kind: "limit", pairId: o.pairId, idx: o.idx };
    }
    if (o.kind === "market" && o.orderId) {
      return { kind: "market", action: o.type, orderId: o.orderId };
    }
    return null;
  }

  async function cancel(o: InflightOrder) {
    const target = cancelTarget(o);
    if (!target) {
      cancelMsg.value = "This order can't be cancelled from here yet.";
      return;
    }
    if (!globalThis.confirm(`Cancel this ${o.type} order on ${o.symbol}?`)) return;
    cancelling.value = { ...cancelling.value, [o.key]: true };
    cancelMsg.value = "";
    try {
      const r = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "cancel failed");
      cancelMsg.value = `Cancel submitted: ${short(d.txHash ?? "")}`;
      await loadInflight();
    } catch (e) {
      cancelMsg.value = e instanceof Error ? e.message : String(e);
    } finally {
      const next = { ...cancelling.value };
      delete next[o.key];
      cancelling.value = next;
    }
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
    loadInflight();
    // Orders settle on the oracle's clock, not just on signal events, so poll.
    const t = setInterval(loadInflight, 6000);
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      // Only react to real signal transitions (skip the connect "hello").
      try {
        if (JSON.parse(e.data)?.type !== "signal") return;
      } catch {
        return;
      }
      load();
      loadInflight();
      if (expanded.value) loadDetail(expanded.value); // refresh open detail too
    };
    es.onerror = () => {/* browser auto-reconnects */};
    return () => {
      clearInterval(t);
      es.close();
    };
  }, []);

  async function refresh() {
    await Promise.all([load(), loadInflight()]);
    if (expanded.value) await loadDetail(expanded.value);
  }

  const inflightCount = useComputed(() => inflight.value.length);

  return (
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h3 class="accent">Signals &amp; orders</h3>
        <button type="button" class="secondary" onClick={refresh}>Refresh</button>
      </div>

      <div class="row" style="justify-content:space-between;margin-top:4px">
        <h4 style="margin:0">
          Orders in flight{" "}
          {inflightCount.value > 0
            ? <span class="badge inflight">{inflightCount.value}</span>
            : null}
        </h4>
        {inflightStale.value ? <span class="muted">⚠ couldn't refresh — last-known</span> : null}
      </div>
      <div class="table-scroll accent-orange" style="max-height:228px;margin-top:8px">
        <table style="table-layout:fixed">
          <colgroup>
            <col style="width:13%" />
            <col style="width:10%" />
            <col style="width:11%" />
            <col style="width:15%" />
            <col style="width:12%" />
            <col style="width:17%" />
            <col style="width:22%" />
          </colgroup>
          <thead>
            <tr>
              <th>pair</th>
              <th>dir</th>
              <th>type</th>
              <th>trigger / px</th>
              <th>size</th>
              <th>status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inflight.value.map((o) => {
              const busy = cancelling.value[o.key] === true;
              const canCancel = cancelTarget(o) !== null;
              return (
                <tr key={o.key}>
                  <td>{o.symbol}</td>
                  <td>
                    <span class={`badge ${o.side === "B" ? "long" : "short"}`}>
                      {o.side === "B" ? "LONG" : "SHORT"}
                    </span>
                  </td>
                  <td class="muted">{o.type}</td>
                  <td class="mono">{px(o.price)}</td>
                  <td class="mono">{sz(o.size)}</td>
                  <td>
                    <span class={`badge ${o.kind === "limit" ? "resting" : "inflight"}`}>
                      {o.kind === "limit" ? "resting" : "in flight"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="danger compact"
                      disabled={busy || !canCancel}
                      title={canCancel ? "Cancel this order" : "Not cancellable yet"}
                      onClick={() => cancel(o)}
                    >
                      {busy ? "Cancelling…" : "Cancel"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {inflight.value.length === 0
              ? (
                <tr>
                  <td colSpan={7} class="muted">
                    No orders in flight. Pending market orders and resting limit/stop orders appear
                    here.
                  </td>
                </tr>
              )
              : null}
          </tbody>
        </table>
      </div>
      {cancelMsg.value ? <p class="muted">{cancelMsg.value}</p> : null}

      <h4 style="margin-top:20px">Webhook calls</h4>
      <div class="table-scroll">
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
                                          {t.error ? <div class="muted">{t.error}</div> : null}
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
                                        <td class="mono">
                                          {oc && oc.status === "executed" ? oc.price : "-"}
                                        </td>
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
      </div>
      <p class="muted">Click a row to see its on-chain execution.</p>
    </div>
  );
}
