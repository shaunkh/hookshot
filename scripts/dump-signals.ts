/** Dev helper: print recent signals + their fan-out txs. Run: deno run -A scripts/dump-signals.ts */
import "@std/dotenv/load";
import { getUserByAddress, listSignals, listSignalTxs } from "@/lib/db/repo.ts";

const user = getUserByAddress("0x000000000000000000000000000000000000beef");
if (!user) {
  console.log("no seed user");
  Deno.exit(0);
}
for (const s of listSignals(user.id, 20)) {
  console.log(
    `${new Date(s.received_at).toISOString()}  ${s.status.padEnd(9)} ${s.action ?? "-"} ${
      s.symbol ?? "-"
    }  reason=${s.reason ?? ""}`,
  );
  for (const tx of listSignalTxs(s.id)) {
    console.log(`    tx#${tx.seq} ${tx.kind} ${tx.status} ${tx.tx_hash ?? ""} ${tx.error ?? ""}`);
  }
}
