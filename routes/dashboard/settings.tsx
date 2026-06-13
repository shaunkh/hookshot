import { page } from "fresh";
import { define } from "@/utils.ts";
import SizeUnitSetting from "@/islands/SizeUnitSetting.tsx";

export const handler = define.handlers({
  GET(ctx) {
    if (!ctx.state.user) return ctx.redirect("/");
    return page();
  },
});

export default define.page(function Settings(ctx) {
  const user = ctx.state.user!;
  return (
    <div class="container">
      <h1>Settings</h1>
      <p>
        <a href="/dashboard">← back to dashboard</a>
      </p>
      <SizeUnitSetting sizeUnit={user.size_unit} defaultLeverage={user.default_leverage} />
    </div>
  );
});
