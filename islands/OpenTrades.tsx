import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

interface Position {
  pairId: string;
  symbol: string;
  side: "B" | "S";
  size: string;
  entryPx: string;
  markPx: string;
  leverage: string;
  notional: string;
  collateral: string;
  unrealizedPnl: string;
  roe: string;
  liquidationPx: string;
  tpPx: string | null;
  slPx: string | null;
  openTimestamp: number;
  idx: number;
}
interface Margin {
  accountValue: string;
  collateral: string;
  notional: string;
  unrealizedPnl: string;
}
interface Account {
  positions: Position[];
  margin: Margin;
  ok?: { positions: boolean; openOrders: boolean; pendingOrders: boolean };
}

// Positions' PnL drifts with price, so refresh on a timer as well as on the
// signal SSE (which fires when a fill changes the position set).
const REFRESH_MS = 6000;

/** Compact USD: 1234567 → "$1.23M"; small values keep cents. null → "—". */
function usd(v: string | number | null): string {
  if (v === null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(2)}`;
}

/** Signed USD, full precision to cents (for PnL). Rounds first so tiny negatives
 * don't render "-$0.00" and a "-0" input doesn't render "$-0.00". */
function signedUsd(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const r = Number(n.toFixed(2)); // collapse -0.004 / -0 to 0
  const mag = Math.abs(r).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return r > 0 ? `+$${mag}` : r < 0 ? `-$${mag}` : `$${mag}`;
}

/** Price with precision adapted to magnitude (BTC vs EUR/USD). */
function px(v: string | null): string {
  if (v === null) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const a = Math.abs(n);
  const dp = a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Base-asset size, trimmed to ≤4 dp. */
function sz(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** ROE fraction → percent. */
function roePct(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const p = n * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function cls(v: string): string {
  const n = Number(v);
  return n > 0 ? "pos" : n < 0 ? "neg" : "muted";
}

interface Props {
  /** Whether the app is on Arbitrum Sepolia (picks the explorer host). */
  testnet?: boolean;
}

export default function OpenTrades(_props: Props) {
  const positions = useSignal<Position[]>([]);
  const margin = useSignal<Margin | null>(null);
  const error = useSignal("");
  const loaded = useSignal(false);
  // True when the positions leg failed on the last fetch (data may be stale).
  const stale = useSignal(false);

  async function load() {
    try {
      const r = await fetch("/api/account");
      if (r.ok) {
        const a = (await r.json()) as Account;
        positions.value = a.positions ?? [];
        margin.value = a.margin ?? null;
        stale.value = a.ok?.positions === false;
        error.value = "";
      } else {
        error.value = (await r.json()).error ?? "failed to load trades";
      }
    } catch {
      error.value = "failed to load trades";
    } finally {
      loaded.value = true;
    }
  }

  useEffect(() => {
    if (!IS_BROWSER) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      // Only react to real signal transitions (skip the connect "hello").
      try {
        if (JSON.parse(e.data)?.type !== "signal") return;
      } catch {
        return;
      }
      load(); // a fill changes the open set
    };
    es.onerror = () => {
      /* browser auto-reconnects */
    };
    return () => {
      clearInterval(t);
      es.close();
    };
  }, []);

  // Show real figures only when the positions leg is fresh and there's something
  // open; otherwise neutral "—" so a stale/empty read never reads as a hard "$0".
  const statReady = useComputed(
    () => !stale.value && margin.value !== null && positions.value.length > 0,
  );
  const pnlClass = useComputed(() =>
    statReady.value && margin.value ? cls(margin.value.unrealizedPnl) : "muted",
  );
  const m = (pick: (x: Margin) => string) =>
    statReady.value && margin.value ? pick(margin.value) : null;

  return (
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h3 class="accent">Open trades</h3>
        <span class="muted">
          {positions.value.length}{" "}
          {positions.value.length === 1 ? "position" : "positions"}
        </span>
      </div>

      {stale.value ? (
        <p class="badge inflight" style="display:inline-block">
          ⚠ Couldn't reach Ostium — showing last-known data, which may be out of
          date.
        </p>
      ) : null}

      <div class="stats">
        <div class="stat">
          <span class="stat-label">Account value</span>
          <span class="stat-value mono">{usd(m((x) => x.accountValue))}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Unrealized PnL</span>
          <span class={`stat-value mono ${pnlClass.value}`}>
            {statReady.value && margin.value
              ? signedUsd(margin.value.unrealizedPnl)
              : "—"}
          </span>
        </div>
        <div class="stat">
          <span class="stat-label">Collateral</span>
          <span class="stat-value mono">{usd(m((x) => x.collateral))}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Notional</span>
          <span class="stat-value mono">{usd(m((x) => x.notional))}</span>
        </div>
      </div>

      {error.value ? <p class="muted">{error.value}</p> : null}

      <div class="table-scroll" style="margin-top:16px">
        <table style="table-layout:fixed">
          <colgroup>
            <col style="width:18%" />
            <col style="width:10%" />
            <col style="width:13%" />
            <col style="width:13%" />
            <col style="width:13%" />
            <col style="width:16%" />
            <col style="width:17%" />
          </colgroup>
          <thead>
            <tr>
              <th>pair</th>
              <th>side</th>
              <th>size</th>
              <th>entry</th>
              <th>mark</th>
              <th>liq. / TP / SL</th>
              <th>PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.value.map((p) => (
              <tr key={`${p.pairId}-${p.idx}`}>
                <td>
                  {p.symbol}
                  <div class="muted mono" style="font-size:12px">
                    {Number(p.leverage).toFixed(1)}×
                  </div>
                </td>
                <td>
                  <span class={`badge ${p.side === "B" ? "long" : "short"}`}>
                    {p.side === "B" ? "LONG" : "SHORT"}
                  </span>
                </td>
                <td class="mono">{sz(p.size)}</td>
                <td class="mono">{px(p.entryPx)}</td>
                <td class="mono">{px(p.markPx)}</td>
                <td class="mono" style="font-size:13px">
                  <span class="neg">{px(p.liquidationPx)}</span>
                  <div class="muted">
                    TP {p.tpPx ? px(p.tpPx) : "—"} · SL{" "}
                    {p.slPx ? px(p.slPx) : "—"}
                  </div>
                </td>
                <td class={`mono ${cls(p.unrealizedPnl)}`}>
                  {signedUsd(p.unrealizedPnl)}
                  <div class="muted" style="font-size:12px">
                    {roePct(p.roe)}
                  </div>
                </td>
              </tr>
            ))}
            {!loaded.value ? (
              <tr>
                <td colSpan={7} class="muted">
                  loading open trades…
                </td>
              </tr>
            ) : positions.value.length === 0 ? (
              <tr>
                <td colSpan={7} class="muted">
                  No open trades. Positions opened by your signals appear here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p class="muted">Live positions</p>
    </div>
  );
}
