import { define } from "@/utils.ts";
import { getConfig } from "@/lib/env.ts";
import { decryptSecret } from "@/lib/crypto.ts";
import {
  deleteWebhook,
  getWebhook,
  listWebhookIps,
  renameWebhook,
  setAllowMode,
} from "@/lib/db/repo.ts";
import type { AllowMode } from "@/lib/types.ts";

export const handler = define.handlers({
  // Full details incl. the (decrypted) secret - used by the Body Helper. Owner only.
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const wh = getWebhook(ctx.params.id);
    if (!wh || wh.user_id !== user.id) return ctx.json({ error: "not found" }, { status: 404 });
    return ctx.json({
      id: wh.id,
      name: wh.name,
      allowMode: wh.allow_mode,
      active: wh.active === 1,
      url: `${getConfig().appOrigin}/h/${wh.id}`,
      secret: await decryptSecret(wh.secret_enc),
      ips: listWebhookIps(wh.id).map((i) => ({ id: i.id, cidr: i.cidr, label: i.label })),
    });
  },

  async PATCH(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const body = await ctx.req.json().catch(() => null);
    let changed = false;
    if (typeof body?.name === "string" && body.name.trim()) {
      changed = renameWebhook(ctx.params.id, user.id, body.name.trim().slice(0, 64)) || changed;
    }
    if (body?.allowMode === "allowlist" || body?.allowMode === "allow_all") {
      changed = setAllowMode(ctx.params.id, user.id, body.allowMode as AllowMode) || changed;
    }
    if (!changed) return ctx.json({ error: "not found or nothing to change" }, { status: 404 });
    return ctx.json({ ok: true });
  },

  DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    return deleteWebhook(ctx.params.id, user.id)
      ? ctx.json({ ok: true })
      : ctx.json({ error: "not found" }, { status: 404 });
  },
});
