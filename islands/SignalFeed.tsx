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

export default function SignalFeed() {
  const signals = useSignal<Sig[]>([]);

  async function load() {
    const r = await fetch("/api/signals?limit=100");
    if (r.ok) signals.value = (await r.json()).signals;
  }

  useEffect(() => {
    if (!IS_BROWSER) return;
    load();
    const es = new EventSource("/api/events");
    es.onmessage = () => load(); // re-pull on any transition (simple + correct)
    es.onerror = () => {/* browser auto-reconnects */};
    return () => es.close();
  }, []);

  return (
    <div class="panel">
      <h3>Signals (live)</h3>
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
          {signals.value.map((s) => (
            <tr key={s.id}>
              <td class="mono">{new Date(s.receivedAt).toLocaleTimeString()}</td>
              <td>{s.action ?? "—"}</td>
              <td>{s.symbol ?? "—"}</td>
              <td>{s.side === "B" ? "long" : s.side === "S" ? "short" : "—"}</td>
              <td>
                <span class={`badge ${s.status}`}>{s.status}</span>
              </td>
              <td class="muted">{s.reason ?? ""}</td>
              <td class="mono muted">{s.sourceIp}</td>
            </tr>
          ))}
          {signals.value.length === 0
            ? (
              <tr>
                <td colSpan={7} class="muted">No signals yet — POST one to a webhook.</td>
              </tr>
            )
            : null}
        </tbody>
      </table>
    </div>
  );
}
