import { page } from "fresh";
import { define } from "@/utils.ts";
import WebhookManager from "@/islands/WebhookManager.tsx";
import BodyHelper from "@/islands/BodyHelper.tsx";

export const handler = define.handlers({
  GET(ctx) {
    if (!ctx.state.user) return ctx.redirect("/");
    return page();
  },
});

export default define.page(function Webhooks(ctx) {
  const user = ctx.state.user!;
  return (
    <div class="container">
      <h1>Webhooks</h1>
      <p>
        <a href="/dashboard">← back to dashboard</a>
      </p>
      <WebhookManager />
      <BodyHelper sizeUnit={user.size_unit} />
    </div>
  );
});
