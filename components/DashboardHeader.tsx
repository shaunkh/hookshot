/**
 * Shared dashboard top bar: the Hookshot wordmark + slogan, the trader address,
 * and the tab nav. Rendered server-side by each dashboard page, which passes its
 * own path as `active` so the current tab is clearly highlighted. Lives in
 * components/ (not islands/) so it stays a plain server component.
 */
import type { UserRow } from "@/lib/types.ts";

interface NavItem {
  href: string;
  label: string;
}
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/webhooks", label: "Webhooks" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardHeader({ user, active }: { user: UserRow; active: string }) {
  return (
    <div class="dash-header">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px">
        <div>
          <h1 style="margin-bottom:2px">Hookshot</h1>
          <p class="muted" style="font-size:16px;margin:0">Catch every move.</p>
        </div>
        <nav class="nav">
          <div class="tabs" role="tablist">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                class={`nav-link${active === n.href ? " active" : ""}`}
                aria-current={active === n.href ? "page" : undefined}
              >
                {n.label}
              </a>
            ))}
          </div>
          <form method="POST" action="/api/logout" style="margin:0">
            <button type="submit" class="secondary">Sign out</button>
          </form>
        </nav>
      </div>
      <p class="muted mono" style="margin-top:8px">{user.trader_addr}</p>
    </div>
  );
}
