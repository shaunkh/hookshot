import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

/**
 * Tab switcher for the trade-helper panels (Build a trade / Pine Script). The
 * panels are server-rendered top-level islands marked with `data-helper-panel`;
 * this island just toggles their visibility via CSS `display`, so neither island
 * is remounted and both keep their state. The choice persists in localStorage.
 */
const TABS = [
  { id: "build", label: "Build a trade" },
  { id: "pine", label: "Pine Script" },
];
const KEY = "hookshot:helper-tab";

export default function HelperTabs() {
  const active = useSignal("build");

  function applyVisibility(id: string) {
    for (const t of TABS) {
      const el = document.querySelector<HTMLElement>(`[data-helper-panel="${t.id}"]`);
      if (el) el.style.display = t.id === id ? "" : "none";
    }
  }

  useEffect(() => {
    if (!IS_BROWSER) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // storage unavailable
    }
    if (saved && TABS.some((t) => t.id === saved)) active.value = saved;
    applyVisibility(active.value);
  }, []);

  function select(id: string) {
    active.value = id;
    applyVisibility(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // ignore
    }
  }

  return (
    <div class="tabs" role="tablist" style="margin-bottom:12px">
      {TABS.map((t) => (
        <button
          type="button"
          key={t.id}
          class={`tab${active.value === t.id ? " active" : ""}`}
          role="tab"
          aria-selected={active.value === t.id}
          onClick={() => select(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
