/**
 * Server-side wrapper for one reorderable dashboard section. Renders a drag
 * handle above the section's content (an island). The actual drag/drop + ordering
 * is wired client-side by the SectionOrderControls island, which finds these by
 * `data-section-id` and reorders them via CSS `order` (so the islands inside are
 * never moved in the DOM and keep their live state). Plain component, not an
 * island - the content it wraps hydrates as a normal top-level island.
 */
import type { ComponentChildren } from "preact";

export default function Section(
  { id, label, children }: { id: string; label: string; children: ComponentChildren },
) {
  return (
    <div class="dash-section" data-section-id={id}>
      <div class="drag-handle" data-drag-handle title="Drag to reorder">
        <span class="grip" aria-hidden="true">⠿</span>
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}
