import { useSignal } from "@preact/signals";

interface Props {
  sizeUnit: string;
  defaultLeverage: string | null;
}

export default function SizeUnitSetting({ sizeUnit, defaultLeverage }: Props) {
  const unit = useSignal(sizeUnit);
  const lev = useSignal(defaultLeverage ?? "");
  const msg = useSignal("");

  async function save() {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sizeUnit: unit.value, defaultLeverage: lev.value || null }),
    });
    msg.value = r.ok ? "Saved." : ((await r.json()).error ?? "Failed.");
  }

  return (
    <div class="panel">
      <h3>Trading settings</h3>
      <div class="row">
        <label>
          Size unit:{" "}
          <select
            value={unit.value}
            onChange={(e) => (unit.value = (e.target as HTMLSelectElement).value)}
          >
            <option value="base">base asset (BTC, oz…)</option>
            <option value="usd_collateral">USD collateral</option>
            <option value="usd_notional">USD notional</option>
          </select>
        </label>
        <label>
          Default leverage:{" "}
          <input
            value={lev.value}
            placeholder="(optional)"
            onInput={(e) => (lev.value = (e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="button" onClick={save}>Save</button>
      </div>
      <p class="muted">
        The size unit decides how every Signal's <code>size</code>{" "}
        is read. Default leverage is used for opens that omit <code>leverage</code>.
      </p>
      {msg.value ? <p class="muted">{msg.value}</p> : null}
    </div>
  );
}
