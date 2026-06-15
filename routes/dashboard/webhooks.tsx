import { page } from "fresh";
import { define } from "@/utils.ts";
import DashboardHeader from "@/components/DashboardHeader.tsx";
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
      <DashboardHeader user={user} active="/dashboard/webhooks" />
      <WebhookManager />
      <BodyHelper sizeUnit={user.size_unit} />
    </div>
  );
});
