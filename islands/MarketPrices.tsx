import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

interface Market {
  pairId: string;
  symbol: string;
  category: string;
  isMarketOpen: boolean;
  mid: string;
  bid: string;
  ask: string;
  maxLeverage: number;
  oiLong: string;
  oiShort: string;
  change24h: number | null;
  volume24h: string | null;
}
interface PricePoint {
  pairId: string;
  bid: string;
  mid: string;
  ask: string;
  isMarketOpen: boolean;
}
interface Live extends PricePoint {
  dir: "up" | "down" | "";
}

// Slow refresh of the static table (OI, 24h stats, new/closed pairs). Live mid
// comes over SSE; this is also the fallback if the websocket is down.
const STATIC_REFRESH_MS = 15000;

/** Compact USD: 1234567 → "$1.23M". */
function usd(v: string | null): string {
  if (v === null) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Price to 2 decimal places with thousands separators. */
function px(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v;
}

function pct(v: number | null): string {
  if (v === null) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function MarketPrices() {
  const markets = useSignal<Market[]>([]);
  const live = useSignal<Record<string, Live>>({});
  const error = useSignal("");
  const openOnly = useSignal(false);
  const query = useSignal("");
  const group = useSignal("");

  async function loadStatic() {
    try {
      const r = await fetch("/api/markets");
      if (r.ok) {
        markets.value = (await r.json()).markets;
        error.value = "";
      } else {
        error.value = (await r.json()).error ?? "failed to load markets";
      }
    } catch {
      error.value = "failed to load markets";
    }
  }

  function patch(points: PricePoint[]) {
    const next = { ...live.value };
    for (const p of points) {
      const prev = next[p.pairId];
      const dir: Live["dir"] = prev
        ? Number(p.mid) > Number(prev.mid)
          ? "up"
          : Number(p.mid) < Number(prev.mid)
          ? "down"
          : prev.dir
        : "";
      next[p.pairId] = { ...p, dir };
    }
    live.value = next;
  }

  useEffect(() => {
    if (!IS_BROWSER) return;
    loadStatic();
    const t = setInterval(loadStatic, STATIC_REFRESH_MS);

    const es = new EventSource("/api/markets/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "prices") patch(msg.points as PricePoint[]);
      } catch {
        // ignore malformed frame
      }
    };
    es.onerror = () => {/* browser auto-reconnects */};

    return () => {
      clearInterval(t);
      es.close();
    };
  }, []);

  const groups = useComputed(() => {
    const set = new Set(markets.value.map((m) => m.category));
    return [...set].sort();
  });

  // Merge static rows with live mid price (and open flag). Server already sorts
  // by 24h volume desc; preserve that order.
  const rows = useComputed(() => {
    const q = query.value.trim().toUpperCase();
    const g = group.value;
    return markets.value
      .map((m) => {
        const l = live.value[m.pairId];
        return l
          ? { ...m, mid: l.mid, isMarketOpen: l.isMarketOpen, dir: l.dir }
          : { ...m, dir: "" as Live["dir"] };
      })
      .filter((m) =>
        (!openOnly.value || m.isMarketOpen) &&
        (!g || m.category === g) &&
        (!q || m.symbol.toUpperCase().includes(q))
      );
  });
  const openCount = useComputed(() => markets.value.filter((m) => m.isMarketOpen).length);

  return (
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h3>Markets &amp; live prices</h3>
        <span class="muted">
          {openCount.value}/{markets.value.length} open
        </span>
      </div>
      <div class="row">
        <input
          placeholder="filter symbol (e.g. BTC)"
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
        <select
          value={group.value}
          onChange={(e) => (group.value = (e.target as HTMLSelectElement).value)}
        >
          <option value="">all groups</option>
          {groups.value.map((g) => <option value={g} key={g}>{g}</option>)}
        </select>
        <label class="row" style="gap:6px">
          <input
            type="checkbox"
            checked={openOnly.value}
            onChange={(e) => (openOnly.value = (e.target as HTMLInputElement).checked)}
          />
          <span class="muted">open markets only</span>
        </label>
      </div>
      {error.value ? <p class="muted">{error.value}</p> : null}
      <div class="table-scroll" style="margin-top:16px">
        <table style="table-layout:fixed">
          <colgroup>
            <col style="width:22%" />
            <col style="width:18%" />
            <col style="width:15%" />
            <col style="width:17%" />
            <col style="width:14%" />
            <col style="width:14%" />
          </colgroup>
          <thead>
            <tr>
              <th>pair</th>
              <th>price</th>
              <th>24H CHG</th>
              <th>24H Vol</th>
              <th>OI (Long)</th>
              <th>OI (Short)</th>
            </tr>
          </thead>
          <tbody>
            {rows.value.map((m) => (
              <tr key={m.pairId}>
                <td>
                  {m.symbol}
                  {!m.isMarketOpen ? <span class="muted">{" "}· closed</span> : null}
                </td>
                <td
                  class="mono"
                  style={m.dir === "up"
                    ? "color:var(--positive)"
                    : m.dir === "down"
                    ? "color:var(--negative)"
                    : ""}
                >
                  {px(m.mid)}
                </td>
                <td
                  class={`mono ${m.change24h === null ? "" : m.change24h >= 0 ? "pos" : "neg"}`}
                >
                  {pct(m.change24h)}
                </td>
                <td class="mono muted">{usd(m.volume24h)}</td>
                <td class="mono">{usd(m.oiLong)}</td>
                <td class="mono">{usd(m.oiShort)}</td>
              </tr>
            ))}
            {markets.value.length === 0 && !error.value
              ? (
                <tr>
                  <td colSpan={6} class="muted">loading markets…</td>
                </tr>
              )
              : null}
            {markets.value.length > 0 && rows.value.length === 0
              ? (
                <tr>
                  <td colSpan={6} class="muted">no markets match.</td>
                </tr>
              )
              : null}
          </tbody>
        </table>
      </div>
      <p class="muted">
        {rows.value.length} markets, sorted by 24h volume - scroll for more. Live prices streamed
        from Ostium.
      </p>
    </div>
  );
}
