/**
 * Combined "trade helpers" section: a tab switcher (HelperTabs) over the two
 * helper panels — Build a trade (BodyHelper) and the TradingView Pine Script
 * generator. Both panels are rendered as normal top-level islands so they
 * hydrate independently; HelperTabs only shows/hides them. The non-default panel
 * is hidden server-side to avoid a flash of both on first paint.
 */
import HelperTabs from "@/islands/HelperTabs.tsx";
import BodyHelper from "@/islands/BodyHelper.tsx";
import PineScript from "@/islands/PineScript.tsx";

export default function TradeHelpers({ sizeUnit }: { sizeUnit: string }) {
  return (
    <div>
      <HelperTabs />
      <div data-helper-panel="build">
        <BodyHelper sizeUnit={sizeUnit} revealSecret={false} />
      </div>
      <div data-helper-panel="pine" style="display:none">
        <PineScript sizeUnit={sizeUnit} />
      </div>
    </div>
  );
}
