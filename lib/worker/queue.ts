/**
 * In-process FIFO job queue with a SINGLE consumer. Serialising execution avoids
 * two Signals racing on the same Slot (e.g. two closes on one position). Jobs are
 * signal ids; the handler is installed by the worker runner.
 */
type JobHandler = (signalId: string) => Promise<void>;

const queue: string[] = [];
let handler: JobHandler | null = null;
let draining = false;

export function setJobHandler(h: JobHandler): void {
  handler = h;
}

/** Current backlog depth — ingest uses this to shed load (429) before accepting. */
export function queueDepth(): number {
  return queue.length;
}

export function enqueue(signalId: string): void {
  queue.push(signalId);
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await handler?.(id);
      } catch (err) {
        console.error(`[worker] job ${id} threw:`, err);
      }
    }
  } finally {
    draining = false;
  }
}
