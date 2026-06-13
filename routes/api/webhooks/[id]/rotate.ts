import { define } from "@/utils.ts";
import { rotateSecret } from "@/lib/db/repo.ts";
import { encryptSecret, randomSecret } from "@/lib/crypto.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const secret = randomSecret();
    const ok = rotateSecret(ctx.params.id, user.id, await encryptSecret(secret));
    return ok ? ctx.json({ secret }) : ctx.json({ error: "not found" }, { status: 404 });
  },
});
