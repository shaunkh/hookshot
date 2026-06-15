import { useRef } from "preact/hooks";
import { useEffect } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

/**
 * Drag-to-reorder for the dashboard sections. Finds the server-rendered
 * `.dash-section[data-section-id]` wrappers and their `[data-drag-handle]`
 * handles, then reorders them purely via CSS `order` (flexbox) on drag — the
 * islands inside are never moved in the DOM, so they keep their live state
 * (SSE connections, fetched data). The chosen order is saved to localStorage,
 * so it persists across sessions / logins on this browser.
 */
const KEY = "hookshot:dashboard-order";

export default function SectionOrderControls() {
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!IS_BROWSER) return;
    const container = document.getElementById("dash-sections");
    if (!container) return;
    const sectionEls = Array.from(
      container.querySelectorAll<HTMLElement>(".dash-section[data-section-id]"),
    );
    const defaultIds = sectionEls
      .map((el) => el.dataset.sectionId ?? "")
      .filter((id) => id !== "");

    // Saved order, reconciled with the sections that actually exist now: keep the
    // saved sequence for known ids, then append any new sections at the end.
    let order: string[] = (() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved)) {
            const known = saved.filter(
              (x): x is string => typeof x === "string" && defaultIds.includes(x),
            );
            return [...known, ...defaultIds.filter((id) => !known.includes(id))];
          }
        }
      } catch {
        // ignore corrupt storage
      }
      return [...defaultIds];
    })();

    const apply = () => {
      for (const el of sectionEls) {
        const id = el.dataset.sectionId ?? "";
        el.style.order = String(Math.max(0, order.indexOf(id)));
      }
    };
    const persist = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(order));
      } catch {
        // storage may be unavailable (private mode) - order just won't persist
      }
    };
    apply();

    let draggingId: string | null = null;
    const cleanups: Array<() => void> = [];

    for (const el of sectionEls) {
      const id = el.dataset.sectionId ?? "";
      const handle = el.querySelector<HTMLElement>("[data-drag-handle]");
      if (handle) {
        handle.setAttribute("draggable", "true");
        const onStart = (e: DragEvent) => {
          draggingId = id;
          el.classList.add("dragging");
          e.dataTransfer?.setData("text/plain", id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        };
        const onEnd = () => {
          el.classList.remove("dragging");
          draggingId = null;
          persist();
        };
        handle.addEventListener("dragstart", onStart);
        handle.addEventListener("dragend", onEnd);
        cleanups.push(() => {
          handle.removeEventListener("dragstart", onStart);
          handle.removeEventListener("dragend", onEnd);
        });
      }
      // Live reorder as you drag over a section, like a sortable list.
      const onOver = (e: DragEvent) => {
        if (draggingId === null || draggingId === id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        const from = order.indexOf(draggingId);
        const to = order.indexOf(id);
        if (from === -1 || to === -1 || from === to) return;
        order.splice(from, 1);
        order.splice(to, 0, draggingId);
        apply();
      };
      const onDrop = (e: DragEvent) => e.preventDefault();
      el.addEventListener("dragover", onOver);
      el.addEventListener("drop", onDrop);
      cleanups.push(() => {
        el.removeEventListener("dragover", onOver);
        el.removeEventListener("drop", onDrop);
      });
    }

    resetRef.current = () => {
      order = [...defaultIds];
      apply();
      try {
        localStorage.removeItem(KEY);
      } catch {
        // ignore
      }
    };

    return () => {
      for (const c of cleanups) c();
    };
  }, []);

  return (
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <span class="muted" style="font-size:12px">
        Drag the <span class="grip" aria-hidden="true">⠿</span> handle on any section to reorder.
      </span>
      <button type="button" class="secondary compact" onClick={() => resetRef.current()}>
        Reset layout
      </button>
    </div>
  );
}
