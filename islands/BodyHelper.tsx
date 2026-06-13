import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

interface WH {
  id: string;
  name: string;
  url: string;
}
interface Props {
  sizeUnit: string;
}

export default function BodyHelper({ sizeUnit }: Props) {
  const list = useSignal<WH[]>([]);
  const sel = useSignal("");
  const secret = useSignal("");
  const action = useSignal("open");
  const symbol = useSignal("BTC/USD");
  const direction = useSignal("long");
  const size = useSignal("0.01");
  const leverage = useSignal("10");

  async function selectWebhook(id: string) {
    sel.value = id;
    const r = await fetch(`/api/webhooks/${id}`);
    if (r.ok) secret.value = (await r.json()).secret;
  }
  async function load() {
    const r = await fetch("/api/webhooks");
    if (r.ok) {
      list.value = (await r.json()).webhooks;
      if (!sel.value && list.value[0]) await selectWebhook(list.value[0].id);
    }
  }
  useEffect(() => {
    if (IS_BROWSER) load();
  }, []);

  const url = useComputed(() => list.value.find((w) => w.id === sel.value)?.url ?? "");
  const unitLabel = sizeUnit === "usd_collateral"
    ? "USD collateral"
    : sizeUnit === "usd_notional"
    ? "USD notional"
    : "base asset";

  const body = useComputed(() => {
    const b: Record<string, unknown> = {
      secret: secret.value || "<secret>",
      action: action.value,
      symbol: symbol.value,
      direction: direction.value,
    };
    if (action.value === "open") {
      b.size = size.value;
      b.leverage = leverage.value;
    } else if (action.value === "close") {
      b.size = size.value;
    } else if (action.value === "modify") {
      b.takeProfit = "0";
    }
    return JSON.stringify(b, null, 2);
  });

  const tv = useComputed(() => {
    const b: Record<string, unknown> = {
      secret: secret.value || "<secret>",
      action: action.value,
      symbol: symbol.value,
      direction: direction.value,
    };
    if (action.value === "open") {
      b.size = "{{strategy.order.contracts}}";
      b.leverage = leverage.value;
    } else if (action.value === "close") {
      b.size = "all";
    }
    return JSON.stringify(b);
  });

  if (list.value.length === 0) {
    return (
      <div class="panel">
        <h3>Webhook body helper</h3>
        <p class="muted">Create a webhook above first.</p>
      </div>
    );
  }

  return (
    <div class="panel">
      <h3>Webhook body helper</h3>
      <div class="row">
        <select
          value={sel.value}
          onChange={(e) => selectWebhook((e.target as HTMLSelectElement).value)}
        >
          {list.value.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}
        </select>
        <select
          value={action.value}
          onChange={(e) => (action.value = (e.target as HTMLSelectElement).value)}
        >
          <option>open</option>
          <option>close</option>
          <option>modify</option>
          <option>cancel</option>
        </select>
        <input
          value={symbol.value}
          onInput={(e) => (symbol.value = (e.target as HTMLInputElement).value)}
        />
        <select
          value={direction.value}
          onChange={(e) => (direction.value = (e.target as HTMLSelectElement).value)}
        >
          <option>long</option>
          <option>short</option>
        </select>
        {action.value === "open" || action.value === "close"
          ? (
            <input
              value={size.value}
              title={`size in ${unitLabel}`}
              onInput={(e) => (size.value = (e.target as HTMLInputElement).value)}
            />
          )
          : null}
        {action.value === "open"
          ? (
            <input
              value={leverage.value}
              title="leverage"
              onInput={(e) => (leverage.value = (e.target as HTMLInputElement).value)}
            />
          )
          : null}
      </div>
      <p class="muted">
        Size is interpreted as <strong>{unitLabel}</strong> (change in Settings). POST this body to:
      </p>
      <p class="mono">{url.value}</p>
      <h4>Request body</h4>
      <pre>{body.value}</pre>
      <h4>TradingView alert message</h4>
      <pre>{tv.value}</pre>
      <p class="muted">
        Point your tool's webhook at the URL above and send this JSON. Remember to add its source
        IP(s) to this webhook's allowlist (or enable allow-all).
      </p>
    </div>
  );
}
