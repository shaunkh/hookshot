import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

interface WH {
  id: string;
  name: string;
  allowMode: string;
  active: boolean;
  url: string;
}
interface Ip {
  id: string;
  cidr: string;
  label: string | null;
}

export default function WebhookManager() {
  const list = useSignal<WH[]>([]);
  const newName = useSignal("");
  const detail = useSignal<Record<string, { secret?: string; ips?: Ip[] }>>({});
  const justCreated = useSignal<string>("");
  const msg = useSignal("");

  async function load() {
    const r = await fetch("/api/webhooks");
    if (r.ok) list.value = (await r.json()).webhooks;
  }
  /** Tell the BodyHelper island its webhook list/secrets may have changed. */
  function notifyChange() {
    if (IS_BROWSER) globalThis.dispatchEvent(new CustomEvent("hookshot:webhooks-changed"));
  }
  useEffect(() => {
    if (IS_BROWSER) load();
  }, []);

  async function create() {
    const r = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.value || "webhook" }),
    });
    if (r.ok) {
      justCreated.value = (await r.json()).secret;
      newName.value = "";
      await load();
      notifyChange();
    }
  }
  async function toggleAllowAll(w: WH) {
    const allowMode = w.allowMode === "allow_all" ? "allowlist" : "allow_all";
    await fetch(`/api/webhooks/${w.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowMode }),
    });
    await load();
  }
  async function rotate(w: WH) {
    const r = await fetch(`/api/webhooks/${w.id}/rotate`, { method: "POST" });
    if (r.ok) {
      justCreated.value = (await r.json()).secret;
      notifyChange();
    }
  }
  async function remove(w: WH) {
    if (!globalThis.confirm(`Delete webhook "${w.name}"? Posters using it will stop working.`)) {
      return;
    }
    await fetch(`/api/webhooks/${w.id}`, { method: "DELETE" });
    await load();
    notifyChange();
  }
  async function loadDetail(w: WH) {
    const r = await fetch(`/api/webhooks/${w.id}`);
    if (r.ok) {
      const d = await r.json();
      detail.value = { ...detail.value, [w.id]: { secret: d.secret, ips: d.ips } };
    }
  }
  async function addIp(w: WH, cidr: string, label: string) {
    const r = await fetch(`/api/webhooks/${w.id}/ips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cidr, label }),
    });
    if (!r.ok) {
      msg.value = (await r.json()).error ?? "failed to add IP";
      return;
    }
    msg.value = "";
    await loadDetail(w);
  }
  async function removeIp(w: WH, ipId: string) {
    await fetch(`/api/webhooks/${w.id}/ips`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ipId }),
    });
    await loadDetail(w);
  }

  return (
    <div>
      <div class="panel">
        <h3>Spin up a webhook</h3>
        <div class="row">
          <input
            placeholder="name (e.g. tv-btc)"
            value={newName.value}
            onInput={(e) => (newName.value = (e.target as HTMLInputElement).value)}
          />
          <button type="button" onClick={create}>Create</button>
        </div>
        {justCreated.value
          ? (
            <p class="mono">
              Secret (copy now): <code>{justCreated.value}</code>
            </p>
          )
          : null}
      </div>

      {list.value.map((w) => {
        const det = detail.value[w.id];
        return (
          <div class="panel" key={w.id}>
            <div class="row" style="justify-content:space-between;gap:16px">
              <strong>{w.name}</strong>
              <span class="muted mono">{w.url}</span>
            </div>
            <div class="row" style="margin-top:12px">
              <button type="button" class="secondary" onClick={() => loadDetail(w)}>
                Reveal secret / IPs
              </button>
              <button type="button" class="secondary" onClick={() => toggleAllowAll(w)}>
                {w.allowMode === "allow_all" ? "Allow-all: ON" : "Allow-all: off (allowlist)"}
              </button>
              <button type="button" class="secondary" onClick={() => rotate(w)}>
                Rotate secret
              </button>
              <button type="button" class="danger" onClick={() => remove(w)}>Delete</button>
            </div>
            {det
              ? (
                <div>
                  <p class="mono">
                    secret: <code>{det.secret}</code>
                  </p>
                  <p class="muted">
                    {w.allowMode === "allow_all"
                      ? "Accepts any source IP (gated by URL + secret only)."
                      : "Allowed source IPs - an empty list denies all (fail closed):"}
                  </p>
                  <ul>
                    {(det.ips ?? []).map((ip) => (
                      <li key={ip.id} class="mono">
                        {ip.cidr} {ip.label ? `(${ip.label})` : ""}{" "}
                        <button type="button" class="secondary" onClick={() => removeIp(w, ip.id)}>
                          remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  <IpAdder onAdd={(c, l) => addIp(w, c, l)} />
                </div>
              )
              : null}
          </div>
        );
      })}
      {msg.value ? <p class="muted">{msg.value}</p> : null}
    </div>
  );
}

function IpAdder({ onAdd }: { onAdd: (cidr: string, label: string) => void }) {
  const cidr = useSignal("");
  const label = useSignal("");
  return (
    <div class="row">
      <input
        placeholder="IP or CIDR (e.g. 52.89.214.238 or 10.0.0.0/8)"
        value={cidr.value}
        onInput={(e) => (cidr.value = (e.target as HTMLInputElement).value)}
      />
      <input
        placeholder="label (optional)"
        value={label.value}
        onInput={(e) => (label.value = (e.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        onClick={() => {
          if (cidr.value) {
            onAdd(cidr.value, label.value);
            cidr.value = "";
            label.value = "";
          }
        }}
      >
        Add IP
      </button>
    </div>
  );
}
