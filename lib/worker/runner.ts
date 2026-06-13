/**
 * The async execution worker: dequeue a Signal id, validate (phase A+B), execute
 * the fan-out, and persist state transitions while emitting SSE events. A single
 * consumer (see queue.ts) serialises execution.
 *
 * Crash recovery is SAFE-BY-DEFAULT: a Signal left in `executing` may have already
 * broadcast on-chain txs, so we never blindly re-run it - it is marked `failed`
 * (needs manual review) on boot. Only never-started (`received`) Signals re-enqueue.
 */
import { enqueue, queueDepth, setJobHandler } from "./queue.ts";
import { getSignal, getUserById, listUnfinishedSignals, updateSignal } from "../db/repo.ts";
import { validateSignal } from "../signal/validate.ts";
import { runExecution } from "../ostium/execute.ts";
import { emit } from "../events/bus.ts";

async function processSignal(signalId: string): Promise<void> {
  // Whole body is guarded so a Signal can never strand in `received`/`executing`.
  try {
    const signal = getSignal(signalId);
    if (!signal) return;
    if (signal.status !== "received" && signal.status !== "executing") return; // already terminal

    const user = getUserById(signal.user_id);
    if (!user) {
      updateSignal(signalId, {
        status: "failed",
        reason: "user not found",
        executedAt: Date.now(),
      });
      return;
    }

    updateSignal(signalId, { status: "executing" });
    emit(user.id, { type: "signal", id: signalId, status: "executing" });

    const vr = await validateSignal(signal.raw_body, {
      sizeUnit: user.size_unit,
      defaultLeverage: user.default_leverage,
    });
    if (!vr.ok) {
      updateSignal(signalId, { status: "rejected", reason: vr.reason, executedAt: Date.now() });
      emit(user.id, { type: "signal", id: signalId, status: "rejected", reason: vr.reason });
      return;
    }

    // Record the resolved intent for the dashboard.
    updateSignal(signalId, { action: vr.cmd.action, symbol: vr.cmd.symbol, side: vr.side });

    const { status, reason } = await runExecution(signal, vr, user);
    updateSignal(signalId, { status, reason: reason ?? null, executedAt: Date.now() });
    emit(user.id, { type: "signal", id: signalId, status, reason });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    updateSignal(signalId, { status: "failed", reason, executedAt: Date.now() });
    const sig = getSignal(signalId);
    if (sig) emit(sig.user_id, { type: "signal", id: signalId, status: "failed", reason });
  }
}

let started = false;

/** Install the job handler and recover in-flight Signals. Idempotent. */
export function startWorker(): void {
  if (started) return;
  started = true;
  setJobHandler(processSignal);
  for (const s of listUnfinishedSignals()) {
    if (s.status === "received") {
      enqueue(s.id); // never started → safe to run
    } else {
      // `executing` may have already broadcast txs - do NOT auto-resubmit.
      updateSignal(s.id, {
        status: "failed",
        reason: "interrupted during execution - not auto-resumed; review on-chain state",
        executedAt: Date.now(),
      });
    }
  }
}

export { enqueue, queueDepth };
