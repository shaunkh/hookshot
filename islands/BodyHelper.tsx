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
  /** When false, the webhook secret is never fetched/shown - a `<secret>` placeholder is used. */
  revealSecret?: boolean;
}

export default function BodyHelper({ sizeUnit, revealSecret = true }: Props) {
  const list = useSignal<WH[]>([]);
  const sel = useSignal("");
  const secret = useSignal("");
  const action = useSignal("open");
  const symbol = useSignal("BTC/USD");
  const direction = useSignal("long");
  const size = useSignal("0.01");
  const sizeBasis = useSignal("size"); // "size" (per Size Unit) | "collateral" (USDC)
  const leverage = useSignal("10");
  const orderType = useSignal("market");
  const price = useSignal("");
  const takeProfit = useSignal("");
  const stopLoss = useSignal("");
  const clientId = useSignal("");
  const copied = useSignal("");

  async function selectWebhook(id: string) {
    sel.value = id;
    if (!revealSecret) return;
    const r = await fetch(`/api/webhooks/${id}`);
    if (r.ok) secret.value = (await r.json()).secret;
  }
  async function load() {
    const r = await fetch("/api/webhooks");
    if (!r.ok) return;
    const webhooks = (await r.json()).webhooks as WH[];
    list.value = webhooks;
    const current = webhooks.find((w) => w.id === sel.value);
    if (current) {
      await selectWebhook(current.id); // refresh secret (e.g. after a rotate)
    } else if (webhooks[0]) {
      await selectWebhook(webhooks[0].id); // selected hook was deleted - pick the first
    } else {
      sel.value = "";
      secret.value = "";
    }
  }
  useEffect(() => {
    if (!IS_BROWSER) return;
    load();
    // Re-pull when WebhookManager creates/deletes/rotates a webhook.
    const onChange = () => load();
    globalThis.addEventListener("hookshot:webhooks-changed", onChange);
    return () => globalThis.removeEventListener("hookshot:webhooks-changed", onChange);
  }, []);

  const url = useComputed(() => list.value.find((w) => w.id === sel.value)?.url ?? "");
  const unitLabel = sizeUnit === "usd_collateral"
    ? "USD collateral"
    : sizeUnit === "usd_notional"
    ? "USD notional"
    : "base asset";

  // Build the signal params, omitting optional fields that are left blank. Both
  // the JSON body and the single-URL (query-param) form derive from this.
  const params = useComputed(() => {
    const b: Record<string, string> = {
      secret: secret.value || "<secret>",
      action: action.value,
      symbol: symbol.value,
      direction: direction.value,
    };
    if (action.value === "open") {
      if (sizeBasis.value === "collateral") b.collateral = size.value;
      else b.size = size.value;
      if (leverage.value) b.leverage = leverage.value;
      b.orderType = orderType.value;
      if (orderType.value !== "market" && price.value) b.price = price.value;
      if (takeProfit.value) b.takeProfit = takeProfit.value;
      if (stopLoss.value) b.stopLoss = stopLoss.value;
    } else if (action.value === "close") {
      b.size = size.value;
    } else if (action.value === "modify") {
      if (takeProfit.value) b.takeProfit = takeProfit.value;
      if (stopLoss.value) b.stopLoss = stopLoss.value;
    } else if (action.value === "cancel") {
      if (orderType.value === "limit" || orderType.value === "stop") b.orderType = orderType.value;
    }
    if (clientId.value) b.clientId = clientId.value;
    return b;
  });

  const body = useComputed(() => JSON.stringify(params.value, null, 2));

  // Single URL with every field in the query string - for tools (like
  // TradingView) whose webhook is just a URL with no body.
  const singleUrl = useComputed(() => {
    if (!url.value) return "";
    return `${url.value}?${new URLSearchParams(params.value).toString()}`;
  });

  const tv = useComputed(() => {
    const b: Record<string, unknown> = {
      secret: secret.value || "<secret>",
      action: action.value,
      symbol: symbol.value,
      direction: direction.value,
    };
    if (action.value === "open") {
      // TradingView's {{strategy.order.contracts}} is a base-size; for a USDC
      // collateral basis there's no placeholder, so emit the static amount.
      if (sizeBasis.value === "collateral") b.collateral = size.value;
      else b.size = "{{strategy.order.contracts}}";
      if (leverage.value) b.leverage = leverage.value;
      b.orderType = orderType.value;
      if (orderType.value !== "market") b.price = "{{strategy.order.price}}";
    } else if (action.value === "close") {
      b.size = "all";
    } else if (action.value === "modify") {
      if (takeProfit.value) b.takeProfit = takeProfit.value;
      if (stopLoss.value) b.stopLoss = stopLoss.value;
    } else if (action.value === "cancel") {
      if (orderType.value === "limit" || orderType.value === "stop") b.orderType = orderType.value;
    }
    return JSON.stringify(b);
  });

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = which;
      setTimeout(() => (copied.value = ""), 1500);
    } catch {
      copied.value = "";
    }
  }

  if (list.value.length === 0) {
    return (
      <div class="panel">
        <h3>Webhook body helper</h3>
        <p class="muted">Create a webhook above first.</p>
      </div>
    );
  }

  const isOpen = action.value === "open";
  const isClose = action.value === "close";
  const isModify = action.value === "modify";
  const isCancel = action.value === "cancel";
  const needsPrice = isOpen && orderType.value !== "market";

  return (
    <div class="panel">
      <h3>Build a trade</h3>
      <p class="muted">
        Compose a trade below, then copy the JSON into your tool (or POST it directly) to fire it at
        the webhook.
      </p>
      {!revealSecret
        ? (
          <p class="muted">
            The <code>{"<secret>"}</code> placeholder is shown here - get the real secret from{" "}
            <a href="/dashboard/webhooks">Webhooks</a> and paste it in before sending.
          </p>
        )
        : null}

      <div class="row">
        <label>
          <span class="muted">Webhook</span>{" "}
          <select
            value={sel.value}
            onChange={(e) => selectWebhook((e.target as HTMLSelectElement).value)}
          >
            {list.value.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label>
          <span class="muted">Action</span>{" "}
          <select
            value={action.value}
            onChange={(e) => (action.value = (e.target as HTMLSelectElement).value)}
          >
            <option>open</option>
            <option>close</option>
            <option>modify</option>
            <option>cancel</option>
          </select>
        </label>
        <label>
          <span class="muted">Symbol</span>{" "}
          <input
            value={symbol.value}
            placeholder="BTC/USD"
            onInput={(e) => (symbol.value = (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          <span class="muted">Direction</span>{" "}
          <select
            value={direction.value}
            onChange={(e) => (direction.value = (e.target as HTMLSelectElement).value)}
          >
            <option>long</option>
            <option>short</option>
          </select>
        </label>
      </div>

      <div class="row" style="margin-top:12px">
        {isOpen
          ? (
            <label>
              <span class="muted">Size basis</span>{" "}
              <select
                value={sizeBasis.value}
                onChange={(e) => (sizeBasis.value = (e.target as HTMLSelectElement).value)}
              >
                <option value="size">size ({unitLabel})</option>
                <option value="collateral">USDC collateral</option>
              </select>
            </label>
          )
          : null}
        {(isOpen || isClose)
          ? (
            <label>
              <span class="muted">
                {isOpen && sizeBasis.value === "collateral"
                  ? "Collateral (USDC)"
                  : `Size (${unitLabel}${isClose ? ` or "all"` : ""})`}
              </span>{" "}
              <input
                value={size.value}
                onInput={(e) => (size.value = (e.target as HTMLInputElement).value)}
              />
            </label>
          )
          : null}
        {isOpen
          ? (
            <label>
              <span class="muted">Leverage</span>{" "}
              <input
                value={leverage.value}
                onInput={(e) => (leverage.value = (e.target as HTMLInputElement).value)}
              />
            </label>
          )
          : null}
        {isOpen
          ? (
            <label>
              <span class="muted">Order type</span>{" "}
              <select
                value={orderType.value}
                onChange={(e) => (orderType.value = (e.target as HTMLSelectElement).value)}
              >
                <option>market</option>
                <option>limit</option>
                <option>stop</option>
              </select>
            </label>
          )
          : null}
        {isCancel
          ? (
            <label>
              <span class="muted">Order type filter</span>{" "}
              <select
                value={orderType.value}
                onChange={(e) => (orderType.value = (e.target as HTMLSelectElement).value)}
              >
                <option value="">any</option>
                <option value="limit">limit</option>
                <option value="stop">stop</option>
              </select>
            </label>
          )
          : null}
        {needsPrice
          ? (
            <label>
              <span class="muted">Price (required for {orderType.value})</span>{" "}
              <input
                value={price.value}
                placeholder="65000"
                onInput={(e) => (price.value = (e.target as HTMLInputElement).value)}
              />
            </label>
          )
          : null}
      </div>

      {(isOpen || isModify)
        ? (
          <div class="row" style="margin-top:12px">
            <label>
              <span class="muted">Take profit{isModify ? ` (0 clears)` : " (optional)"}</span>{" "}
              <input
                value={takeProfit.value}
                placeholder="75000"
                onInput={(e) => (takeProfit.value = (e.target as HTMLInputElement).value)}
              />
            </label>
            <label>
              <span class="muted">Stop loss{isModify ? ` (0 clears)` : " (optional)"}</span>{" "}
              <input
                value={stopLoss.value}
                placeholder="60000"
                onInput={(e) => (stopLoss.value = (e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
        )
        : null}

      <div class="row" style="margin-top:12px">
        <label>
          <span class="muted">Client ID (optional, idempotency key)</span>{" "}
          <input
            value={clientId.value}
            placeholder="my-alert-1"
            onInput={(e) => (clientId.value = (e.target as HTMLInputElement).value)}
          />
        </label>
      </div>

      <p class="muted" style="margin-top:12px">
        Size is interpreted as <strong>{unitLabel}</strong> (change in Settings). POST this body to:
      </p>
      <p class="mono">{url.value}</p>

      <h4>Request body</h4>
      <pre>{body.value}</pre>
      <div class="row">
        <button type="button" onClick={() => copy(body.value, "body")}>
          {copied.value === "body" ? "Copied ✓" : "Copy JSON"}
        </button>
      </div>

      <h4>Single URL (all params in the query)</h4>
      <p class="muted">
        For tools whose webhook is just a URL with no message body - paste this whole URL as the
        webhook URL.
      </p>
      <pre>{singleUrl.value}</pre>
      <div class="row">
        <button type="button" onClick={() => copy(singleUrl.value, "url")}>
          {copied.value === "url" ? "Copied ✓" : "Copy URL"}
        </button>
      </div>

      <h4>TradingView alert message</h4>
      <pre>{tv.value}</pre>
      <div class="row">
        <button type="button" class="secondary" onClick={() => copy(tv.value, "tv")}>
          {copied.value === "tv" ? "Copied ✓" : "Copy TradingView message"}
        </button>
      </div>

      <p class="muted" style="margin-top:12px">
        Point your tool's webhook at the URL above and send this JSON. Remember to add its source
        IP(s) to this webhook's allowlist (or enable allow-all).
      </p>
    </div>
  );
}
