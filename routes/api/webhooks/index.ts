import { define } from "@/utils.ts";
import { getConfig } from "@/lib/env.ts";
import { createWebhook, listWebhooks } from "@/lib/db/repo.ts";
import { encryptSecret, randomSecret } from "@/lib/crypto.ts";
import type { WebhookRow } from "@/lib/types.ts";

export function webhookView(w: WebhookRow) {
  return {
    id: w.id,
    name: w.name,
    allowMode: w.allow_mode,
    active: w.active === 1,
    createdAt: w.created_at,
    url: `${getConfig().appOrigin}/h/${w.id}`,
  };
}

export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    return ctx.json({ webhooks: listWebhooks(user.id).map(webhookView) });
  },
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const body = await ctx.req.json().catch(() => null);
    const name = typeof body?.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 64)
      : "webhook";
    const secret = randomSecret(); // shown once here; also revealable later via GET [id]
    const wh = createWebhook(user.id, name, await encryptSecret(secret));
    return ctx.json({ webhook: webhookView(wh), secret }, { status: 201 });
  },
});
