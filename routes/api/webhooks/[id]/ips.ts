import { define } from "@/utils.ts";
import { addWebhookIp, deleteWebhookIp, getWebhook, listWebhookIps } from "@/lib/db/repo.ts";
import { parseIp } from "@/lib/webhook/ip.ts";

/** Normalise a bare IP to /32 or /128; validate an explicit CIDR. */
function normalizeCidr(input: string): string | null {
  const s = input.trim();
  if (s.includes("/")) {
    const [ip, p] = s.split("/");
    const parsed = parseIp(ip);
    if (!parsed) return null;
    const prefix = Number(p);
    const bits = parsed.version === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
    return `${ip}/${prefix}`;
  }
  const parsed = parseIp(s);
  if (!parsed) return null;
  return `${s}/${parsed.version === 4 ? 32 : 128}`;
}

function ownedWebhook(ctx: { state: { user?: { id: string } }; params: Record<string, string> }) {
  const user = ctx.state.user;
  if (!user) return { error: 401 as const };
  const wh = getWebhook(ctx.params.id);
  if (!wh || wh.user_id !== user.id) return { error: 404 as const };
  return { wh };
}

export const handler = define.handlers({
  GET(ctx) {
    const r = ownedWebhook(ctx);
    if ("error" in r) return ctx.json({ error: "no" }, { status: r.error });
    return ctx.json({
      ips: listWebhookIps(r.wh.id).map((i) => ({ id: i.id, cidr: i.cidr, label: i.label })),
    });
  },

  async POST(ctx) {
    const r = ownedWebhook(ctx);
    if ("error" in r) return ctx.json({ error: "no" }, { status: r.error });
    const body = await ctx.req.json().catch(() => null);
    const cidr = typeof body?.cidr === "string" ? normalizeCidr(body.cidr) : null;
    if (!cidr) return ctx.json({ error: "invalid IP or CIDR" }, { status: 400 });
    const label = typeof body?.label === "string" ? body.label.slice(0, 64) : null;
    const ip = addWebhookIp(r.wh.id, cidr, label);
    return ctx.json({ ip: { id: ip.id, cidr: ip.cidr, label: ip.label } }, { status: 201 });
  },

  async DELETE(ctx) {
    const r = ownedWebhook(ctx);
    if ("error" in r) return ctx.json({ error: "no" }, { status: r.error });
    const body = await ctx.req.json().catch(() => null);
    const ipId = typeof body?.ipId === "string" ? body.ipId : "";
    return deleteWebhookIp(ipId, r.wh.id)
      ? ctx.json({ ok: true })
      : ctx.json({ error: "not found" }, { status: 404 });
  },
});
